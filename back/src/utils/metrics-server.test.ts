import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { logTraceMock, logErrorMock } = vi.hoisted(() => ({ logTraceMock: vi.fn(), logErrorMock: vi.fn() }));
vi.mock('./logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: logTraceMock, logError: logErrorMock, logFromError: vi.fn() }),
}));

const { createMetricsServer } = await import('./metrics-server');

const listening = (server: ReturnType<typeof createMetricsServer>['server']) => new Promise<void>((resolve) => {
  server.on('listening', () => resolve());
});

const urlFor = (server: ReturnType<typeof createMetricsServer>['server']) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- server is listening on a TCP port, never a pipe, at the point this is called
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/metrics`;
};

const defaultOptions = {
  host: '127.0.0.1',
  port: 0,
  ownProcessName: 'pm',
  minIntervalMs: 5_000,
  collectTimeoutMs: 2_000,
  roundDeadlineMs: 4_000,
  maxReplyBytes: 2 * 1024 * 1024,
  recordOutcome: () => {},
};

describe('createMetricsServer', () => {
  let created: ReturnType<typeof createMetricsServer> | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => created?.server.close(() => resolve()));
    created = undefined;
    logTraceMock.mockClear();
    logErrorMock.mockClear();
  });

  it('merges the process manager own snapshot with every child snapshot into one Content-Type: text/plain response', async () => {
    created = createMetricsServer({
      ...defaultOptions,
      collectOwnSnapshot: () => Promise.resolve('# HELP opencrq_pm_processes count\n# TYPE opencrq_pm_processes gauge\nopencrq_pm_processes{state="RUNNING",process_name="pm"} 2\n'),
      collectFromChildren: async (roundId, awaitChildReply, reportChild) => {
        setTimeout(() => created?.handleReply('worker', roundId, '# HELP http_server_x count\n# TYPE http_server_x counter\nhttp_server_x_total{process_name="worker"} 5\n'), 0);
        const reply = await awaitChildReply('worker');
        if (reply.outcome === 'ok') {
          reportChild({ processName: 'worker', outcome: 'ok', durationSeconds: 0.01, text: reply.text });
        }
      },
    });
    await listening(created.server);

    const response = await fetch(urlFor(created.server));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(body).toContain('opencrq_pm_processes{state="RUNNING",process_name="pm"} 2');
    expect(body).toContain('http_server_x_total{process_name="worker"} 5');
  });

  it('resolves each pending reply against its own (roundId, processName) pair, so two concurrent children both land in the merged output', async () => {
    created = createMetricsServer({
      ...defaultOptions,
      collectOwnSnapshot: () => Promise.resolve(''),
      collectFromChildren: async (roundId, awaitChildReply, reportChild) => {
        setTimeout(() => created?.handleReply('worker', roundId, '# HELP worker_metric x\n# TYPE worker_metric counter\nworker_metric_total{process_name="worker"} 1\n'), 0);
        setTimeout(() => created?.handleReply('api', roundId, '# HELP api_metric x\n# TYPE api_metric counter\napi_metric_total{process_name="api"} 2\n'), 0);
        const [worker, api] = await Promise.all([awaitChildReply('worker'), awaitChildReply('api')]);
        if (worker.outcome === 'ok') {
          reportChild({ processName: 'worker', outcome: 'ok', durationSeconds: 0.01, text: worker.text });
        }
        if (api.outcome === 'ok') {
          reportChild({ processName: 'api', outcome: 'ok', durationSeconds: 0.01, text: api.text });
        }
      },
    });
    await listening(created.server);

    const response = await fetch(urlFor(created.server));
    const body = await response.text();

    expect(body).toContain('worker_metric_total{process_name="worker"} 1');
    expect(body).toContain('api_metric_total{process_name="api"} 2');
  });

  it('silently ignores a reply for a (roundId, processName) pair nobody is awaiting, without throwing', async () => {
    created = createMetricsServer({
      ...defaultOptions,
      collectOwnSnapshot: () => Promise.resolve(''),
      collectFromChildren: () => Promise.resolve(),
    });
    await listening(created.server);

    expect(() => created?.handleReply('ghost', 'no-such-round', 'text')).not.toThrow();
  });

  it('refuses a non-GET/HEAD method with 405 and triggers no collection', async () => {
    const collectOwnSnapshot = vi.fn(() => Promise.resolve(''));
    const collectFromChildren = vi.fn(() => Promise.resolve());
    created = createMetricsServer({ ...defaultOptions, collectOwnSnapshot, collectFromChildren });
    await listening(created.server);

    const response = await fetch(urlFor(created.server), { method: 'POST' });

    expect(response.status).toBe(405);
    expect(collectOwnSnapshot).not.toHaveBeenCalled();
    expect(collectFromChildren).not.toHaveBeenCalled();
  });

  it('triggers collectOwnSnapshot exactly once for two concurrent GET requests, both of which still get a response', async () => {
    const collectOwnSnapshot = vi.fn(() => new Promise<string>((resolve) => setTimeout(() => resolve(''), 10)));
    created = createMetricsServer({ ...defaultOptions, collectOwnSnapshot, collectFromChildren: () => Promise.resolve() });
    await listening(created.server);

    const [first, second] = await Promise.all([fetch(urlFor(created.server)), fetch(urlFor(created.server))]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(collectOwnSnapshot).toHaveBeenCalledTimes(1);
  });

  it('serves the cached document, without a second collection, for a request sent within minIntervalMs of the previous one', async () => {
    const collectOwnSnapshot = vi.fn(() => Promise.resolve(''));
    created = createMetricsServer({ ...defaultOptions, minIntervalMs: 10_000, collectOwnSnapshot, collectFromChildren: () => Promise.resolve() });
    await listening(created.server);

    await fetch(urlFor(created.server));
    await fetch(urlFor(created.server));

    expect(collectOwnSnapshot).toHaveBeenCalledTimes(1);
  });

  it('advances the cache floor on a failed collection: an immediate second request is served the cached failure rather than starting another collection', async () => {
    const collectOwnSnapshot = vi.fn(() => Promise.reject(new Error('boom')));
    created = createMetricsServer({ ...defaultOptions, minIntervalMs: 10_000, collectOwnSnapshot, collectFromChildren: () => Promise.resolve() });
    await listening(created.server);

    const first = await fetch(urlFor(created.server));
    const second = await fetch(urlFor(created.server));

    expect(first.status).toBe(500);
    expect(second.status).toBe(500);
    expect(collectOwnSnapshot).toHaveBeenCalledTimes(1);
  });

  it('skips a child that never replies after collectTimeoutMs, and the response still contains every other process metrics', async () => {
    created = createMetricsServer({
      ...defaultOptions,
      collectTimeoutMs: 20,
      roundDeadlineMs: 200,
      collectOwnSnapshot: () => Promise.resolve(''),
      collectFromChildren: async (roundId, awaitChildReply, reportChild) => {
        setTimeout(() => created?.handleReply('worker', roundId, '# HELP worker_metric x\n# TYPE worker_metric counter\nworker_metric_total{process_name="worker"} 1\n'), 0);
        // "stuck" never replies — its own promise settles only via the per-child timeout above.
        const [worker, stuck] = await Promise.all([awaitChildReply('worker'), awaitChildReply('stuck')]);
        if (worker.outcome === 'ok') {
          reportChild({ processName: 'worker', outcome: 'ok', durationSeconds: 0.01, text: worker.text });
        }
        expect(stuck.outcome).toBe('timeout');
      },
    });
    await listening(created.server);

    const response = await fetch(urlFor(created.server));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('worker_metric_total{process_name="worker"} 1');
  });

  it('still responds within roundDeadlineMs, using whatever already resolved, when the aggregate work is slower than the deadline', async () => {
    const outcomes: Array<{ processName: string, outcome: string }> = [];
    created = createMetricsServer({
      ...defaultOptions,
      roundDeadlineMs: 20,
      recordOutcome: (processName, outcome) => outcomes.push({ processName, outcome }),
      collectOwnSnapshot: () => new Promise<string>(() => {}), // never resolves within the test
      collectFromChildren: async (roundId, awaitChildReply, reportChild) => {
        setTimeout(() => created?.handleReply('worker', roundId, '# HELP worker_metric x\n# TYPE worker_metric counter\nworker_metric_total{process_name="worker"} 1\n'), 0);
        const reply = await awaitChildReply('worker');
        if (reply.outcome === 'ok') {
          reportChild({ processName: 'worker', outcome: 'ok', durationSeconds: 0.01, text: reply.text });
        }
      },
    });
    await listening(created.server);

    const response = await fetch(urlFor(created.server));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('worker_metric_total{process_name="worker"} 1');
    // The own block never resolved before the deadline: excluded from the merge above, and its
    // outcome must still land as a timeout rather than being silently dropped.
    expect(outcomes).toContainEqual({ processName: 'pm', outcome: 'timeout' });
  });

  it('forces a still-pending child reply to a timeout outcome once the round deadline elapses, instead of leaving it unresolved', async () => {
    const observedOutcomes: Array<string> = [];
    created = createMetricsServer({
      ...defaultOptions,
      collectTimeoutMs: 10_000,
      roundDeadlineMs: 20,
      collectOwnSnapshot: () => Promise.resolve(''),
      collectFromChildren: async (_roundId, awaitChildReply) => {
        // "stuck" never replies, and its own per-child timeout (10s) is far longer than the
        // round deadline (20ms) below — it must still be forced to a timeout outcome once the
        // round ends, rather than settling unnoticed in the background well after the response.
        const stuck = await awaitChildReply('stuck');
        observedOutcomes.push(stuck.outcome);
      },
    });
    await listening(created.server);

    const response = await fetch(urlFor(created.server));

    expect(response.status).toBe(200);
    await vi.waitFor(() => {
      expect(observedOutcomes).toEqual(['timeout']);
    });
  });

  it('discards a reply exceeding maxReplyBytes, contributing nothing to the merged output', async () => {
    created = createMetricsServer({
      ...defaultOptions,
      maxReplyBytes: 10,
      collectOwnSnapshot: () => Promise.resolve(''),
      collectFromChildren: async (roundId, awaitChildReply, reportChild) => {
        setTimeout(() => created?.handleReply('worker', roundId, '# HELP worker_metric x\n# TYPE worker_metric counter\nworker_metric_total{process_name="worker"} 1\n'), 0);
        const reply = await awaitChildReply('worker');
        expect(reply.outcome).toBe('oversized');
        if (reply.outcome === 'ok') {
          reportChild({ processName: 'worker', outcome: 'ok', durationSeconds: 0.01, text: reply.text });
        }
      },
    });
    await listening(created.server);

    const response = await fetch(urlFor(created.server));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain('worker_metric');
  });

  it('records an "ok" outcome for a valid child contribution and an "invalid" one for a child whose reply fails merge validation', async () => {
    const recordOutcome = vi.fn();
    created = createMetricsServer({
      ...defaultOptions,
      recordOutcome,
      collectOwnSnapshot: () => Promise.resolve('# HELP pm_metric x\n# TYPE pm_metric counter\npm_metric_total{process_name="pm"} 1\n'),
      collectFromChildren: async (roundId, awaitChildReply, reportChild) => {
        setTimeout(() => {
          created?.handleReply('worker', roundId, '# HELP worker_metric x\n# TYPE worker_metric counter\nworker_metric_total{process_name="worker"} 1\n');
          created?.handleReply('broken', roundId, '# HELP broken_metric x\n# TYPE broken_metric counter\nbroken_metric_total 1\n');
        }, 0);
        const [worker, broken] = await Promise.all([awaitChildReply('worker'), awaitChildReply('broken')]);
        if (worker.outcome === 'ok') {
          reportChild({ processName: 'worker', outcome: 'ok', durationSeconds: 0.02, text: worker.text });
        }
        if (broken.outcome === 'ok') {
          reportChild({ processName: 'broken', outcome: 'ok', durationSeconds: 0.03, text: broken.text });
        }
      },
    });
    await listening(created.server);

    await fetch(urlFor(created.server));

    expect(recordOutcome).toHaveBeenCalledWith('worker', 'ok', 0.02);
    expect(recordOutcome).toHaveBeenCalledWith('broken', 'invalid', 0.03);
  });

  it('answers 404 on any path other than /metrics, without triggering a collection', async () => {
    const collectOwnSnapshot = vi.fn(() => Promise.resolve(''));
    created = createMetricsServer({ ...defaultOptions, collectOwnSnapshot, collectFromChildren: () => Promise.resolve() });
    await listening(created.server);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- server is listening on a TCP port, never a pipe, at this point
    const { port } = created.server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/`);

    expect(response.status).toBe(404);
    expect(collectOwnSnapshot).not.toHaveBeenCalled();
  });

  it('records an "empty" outcome for a child that answers with no sample line at all', async () => {
    const recordOutcome = vi.fn();
    created = createMetricsServer({
      ...defaultOptions,
      recordOutcome,
      collectOwnSnapshot: () => Promise.resolve(''),
      collectFromChildren: async (roundId, awaitChildReply, reportChild) => {
        setTimeout(() => created?.handleReply('worker', roundId, ''), 0);
        const reply = await awaitChildReply('worker');
        if (reply.outcome === 'ok') {
          reportChild({ processName: 'worker', outcome: 'ok', durationSeconds: 0.01, text: reply.text });
        }
      },
    });
    await listening(created.server);

    await fetch(urlFor(created.server));

    expect(recordOutcome).toHaveBeenCalledWith('worker', 'empty', 0.01);
  });

  it('records an outcome for the process manager own block when it fails the same validation a child block would', async () => {
    const recordOutcome = vi.fn();
    created = createMetricsServer({
      ...defaultOptions,
      recordOutcome,
      collectOwnSnapshot: () => Promise.resolve('# HELP pm_metric x\n# TYPE pm_metric counter\npm_metric_total 1\n'),
      collectFromChildren: () => Promise.resolve(),
    });
    await listening(created.server);

    await fetch(urlFor(created.server));

    expect(recordOutcome).toHaveBeenCalledWith('pm', 'invalid', expect.any(Number));
  });

  it('records a timeout for a child whose reply lands after the round deadline, instead of losing it from both the document and the counters', async () => {
    const recordOutcome = vi.fn();
    created = createMetricsServer({
      ...defaultOptions,
      collectTimeoutMs: 10_000,
      roundDeadlineMs: 20,
      recordOutcome,
      collectOwnSnapshot: () => Promise.resolve(''),
      collectFromChildren: async (roundId, awaitChildReply, reportChild) => {
        // Lands well after the deadline the response was produced on.
        setTimeout(() => created?.handleReply('late', roundId, '# HELP late_metric x\n# TYPE late_metric counter\nlate_metric_total{process_name="late"} 1\n'), 60);
        const reply = await awaitChildReply('late');
        reportChild({ processName: 'late', outcome: reply.outcome === 'ok' ? 'ok' : reply.outcome, durationSeconds: 0.05 });
      },
    });
    await listening(created.server);

    const response = await fetch(urlFor(created.server));
    const body = await response.text();

    expect(body).not.toContain('late_metric_total');
    await vi.waitFor(() => {
      expect(recordOutcome).toHaveBeenCalledWith('late', 'timeout', 0.05);
    });
  });

  it('starts no second round while the previous one is still fanning out, even once its response has been served', async () => {
    const collectOwnSnapshot = vi.fn(() => Promise.resolve(''));
    let release: (() => void) | undefined;
    created = createMetricsServer({
      ...defaultOptions,
      minIntervalMs: 0,
      collectTimeoutMs: 10_000,
      roundDeadlineMs: 20,
      collectOwnSnapshot,
      collectFromChildren: async () => {
        // Outlives the round deadline: the response is served from the merge while this is still
        // pending, which is exactly the window a second `metrics-collect` must not open in.
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });
    await listening(created.server);

    await fetch(urlFor(created.server));
    await fetch(urlFor(created.server));

    expect(collectOwnSnapshot).toHaveBeenCalledTimes(1);
    release?.();
  });

  it('answers 500 when a collector throws synchronously, rather than leaving the request hanging on a rejection nobody handles', async () => {
    created = createMetricsServer({
      ...defaultOptions,
      collectOwnSnapshot: () => {
        throw new Error('sync boom');
      },
      collectFromChildren: () => Promise.resolve(),
    });
    await listening(created.server);

    const response = await fetch(urlFor(created.server));

    expect(response.status).toBe(500);
  });

  it('settles a pending reply as not_connected when the caller observes the child leave, without waiting out its timeout', async () => {
    const recordOutcome = vi.fn();
    created = createMetricsServer({
      ...defaultOptions,
      collectTimeoutMs: 10_000,
      recordOutcome,
      collectOwnSnapshot: () => Promise.resolve(''),
      collectFromChildren: async (roundId, awaitChildReply, reportChild) => {
        setTimeout(() => created?.abandonPendingReply('gone', roundId), 0);
        const reply = await awaitChildReply('gone');
        reportChild({ processName: 'gone', outcome: reply.outcome === 'ok' ? 'ok' : reply.outcome, durationSeconds: 0.01 });
      },
    });
    await listening(created.server);

    const response = await fetch(urlFor(created.server));

    expect(response.status).toBe(200);
    expect(recordOutcome).toHaveBeenCalledWith('gone', 'not_connected', 0.01);
  });

  it('logs a `# TYPE` disagreement between merged families at error level, since the family is dropped from the scrape', async () => {
    created = createMetricsServer({
      ...defaultOptions,
      collectOwnSnapshot: () => Promise.resolve('# HELP opencrq_ambiguous x\n# TYPE opencrq_ambiguous counter\nopencrq_ambiguous_total{process_name="pm"} 1\n'),
      collectFromChildren: async (roundId, awaitChildReply, reportChild) => {
        setTimeout(() => created?.handleReply('worker', roundId, '# HELP opencrq_ambiguous x\n# TYPE opencrq_ambiguous gauge\nopencrq_ambiguous{process_name="worker"} 2\n'), 0);
        const reply = await awaitChildReply('worker');
        if (reply.outcome === 'ok') {
          reportChild({ processName: 'worker', outcome: 'ok', durationSeconds: 0.01, text: reply.text });
        }
      },
    });
    await listening(created.server);

    await fetch(urlFor(created.server));

    expect(logErrorMock).toHaveBeenCalledWith('Rejected part of a metrics scrape while merging', {
      invalidProcesses: [],
      droppedFamilies: [{ name: 'opencrq_ambiguous', reason: 'type-conflict' }],
    });
    expect(logTraceMock).not.toHaveBeenCalledWith('Metric family metadata disagrees between producers, kept the first text seen', expect.anything());
  });

  it('logs a `# HELP`/`# UNIT` disagreement at trace level only, since the family is kept', async () => {
    created = createMetricsServer({
      ...defaultOptions,
      collectOwnSnapshot: () => Promise.resolve('# HELP opencrq_shared first text\n# TYPE opencrq_shared counter\nopencrq_shared_total{process_name="pm"} 1\n'),
      collectFromChildren: async (roundId, awaitChildReply, reportChild) => {
        setTimeout(() => created?.handleReply('worker', roundId, '# HELP opencrq_shared second text\n# TYPE opencrq_shared counter\nopencrq_shared_total{process_name="worker"} 2\n'), 0);
        const reply = await awaitChildReply('worker');
        if (reply.outcome === 'ok') {
          reportChild({ processName: 'worker', outcome: 'ok', durationSeconds: 0.01, text: reply.text });
        }
      },
    });
    await listening(created.server);

    await fetch(urlFor(created.server));

    expect(logTraceMock).toHaveBeenCalledWith('Metric family metadata disagrees between producers, kept the first text seen', {
      metadataConflicts: [{ name: 'opencrq_shared', field: 'help' }],
    });
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it('logs a family carrying both a `# TYPE` and a `# HELP` disagreement only at error level, since the family is dropped, not kept', async () => {
    created = createMetricsServer({
      ...defaultOptions,
      collectOwnSnapshot: () => Promise.resolve('# HELP opencrq_both first text\n# TYPE opencrq_both counter\nopencrq_both_total{process_name="pm"} 1\n'),
      collectFromChildren: async (roundId, awaitChildReply, reportChild) => {
        setTimeout(() => created?.handleReply('worker', roundId, '# HELP opencrq_both second text\n# TYPE opencrq_both gauge\nopencrq_both{process_name="worker"} 2\n'), 0);
        const reply = await awaitChildReply('worker');
        if (reply.outcome === 'ok') {
          reportChild({ processName: 'worker', outcome: 'ok', durationSeconds: 0.01, text: reply.text });
        }
      },
    });
    await listening(created.server);

    await fetch(urlFor(created.server));

    expect(logErrorMock).toHaveBeenCalledWith('Rejected part of a metrics scrape while merging', {
      invalidProcesses: [],
      droppedFamilies: [{ name: 'opencrq_both', reason: 'type-conflict' }],
    });
    expect(logTraceMock).not.toHaveBeenCalledWith('Metric family metadata disagrees between producers, kept the first text seen', expect.anything());
  });
});
