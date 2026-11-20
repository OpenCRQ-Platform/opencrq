import crypto from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CollectionFailureReason } from './pm-metrics';
import { createLogger } from './logger';
import { mergeMetricsSnapshots } from './metrics-merge';

const { logTrace, logError, logFromError } = createLogger({ engine: 'telemetry' });

export const METRICS_PATH = '/metrics';

// A per-child failure is an outcome, not a request failure: `awaitChildReply` never rejects.
export type ChildReplyOutcome =
  | { outcome: 'ok', text: string }
  | { outcome: 'timeout' }
  | { outcome: 'not_connected' }
  | { outcome: 'oversized' };

export interface ChildCollectionResult {
  processName: string,
  outcome: 'ok' | CollectionFailureReason,
  durationSeconds: number,
  text?: string,
}

interface CreateMetricsServerOptions {
  host: string,
  port: number,
  publicPort?: number,
  ownProcessName: string,
  minIntervalMs: number,
  collectTimeoutMs: number,
  roundDeadlineMs: number,
  maxReplyBytes: number,
  collectOwnSnapshot: () => Promise<string>,
  collectFromChildren: (
    roundId: string,
    awaitChildReply: (processName: string) => Promise<ChildReplyOutcome>,
    reportChild: (result: ChildCollectionResult) => void,
  ) => Promise<void>,
  // The single recorder for a round, the caller's pre-flight failures included: a second path
  // would miss the outcomes this module decides on its own.
  recordOutcome: (processName: string, outcome: 'ok' | CollectionFailureReason, durationSeconds: number) => void,
}

interface CollectionResult {
  statusCode: number,
  body: string,
}

const isScrapeMethod = (method: string | undefined): method is 'GET' | 'HEAD' => method === 'GET' || method === 'HEAD';

export const createMetricsServer = ({
  host, port, publicPort, ownProcessName, minIntervalMs, collectTimeoutMs, roundDeadlineMs, maxReplyBytes,
  collectOwnSnapshot, collectFromChildren, recordOutcome,
}: CreateMetricsServerOptions) => {
  const pending = new Map<string, { resolve: (reply: ChildReplyOutcome) => void, timer: NodeJS.Timeout }>();

  const awaitChildReply = (roundId: string) => (processName: string): Promise<ChildReplyOutcome> => {
    const key = `${roundId}:${processName}`;
    return new Promise<ChildReplyOutcome>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(key);
        resolve({ outcome: 'timeout' });
      }, collectTimeoutMs).unref();
      pending.set(key, { resolve, timer });
    });
  };

  const handleReply = (processName: string, roundId: string, text: string, oversized = false) => {
    const key = `${roundId}:${processName}`;
    const entry = pending.get(key);
    if (!entry) {
      return;
    }
    pending.delete(key);
    clearTimeout(entry.timer);
    if (oversized || Buffer.byteLength(text, 'utf8') > maxReplyBytes) {
      entry.resolve({ outcome: 'oversized' });
      return;
    }
    entry.resolve({ outcome: 'ok', text });
  };

  // For a child the caller saw leave: nothing else settles it before the per-child timeout.
  const abandonPendingReply = (processName: string, roundId: string) => {
    const key = `${roundId}:${processName}`;
    const entry = pending.get(key);
    if (!entry) {
      return;
    }
    pending.delete(key);
    clearTimeout(entry.timer);
    entry.resolve({ outcome: 'not_connected' });
  };

  // A no-op when `work` won the race, since every child promise has settled by then.
  const forceTimeoutPending = (roundId: string) => {
    const prefix = `${roundId}:`;
    for (const [key, entry] of pending) {
      if (key.startsWith(prefix)) {
        pending.delete(key);
        clearTimeout(entry.timer);
        entry.resolve({ outcome: 'timeout' });
      }
    }
  };

  let lastCollectionStartedAt = 0;
  let cached: CollectionResult | undefined;
  let inFlight: Promise<CollectionResult> | undefined;

  const runRound = async (onRoundSettled: () => void): Promise<CollectionResult> => {
    const roundId = crypto.randomUUID();
    const reports: Array<ChildCollectionResult> = [];
    let roundClosed = false;
    let ownText: string | undefined;
    let ownSettled = false;
    let ownDurationSeconds = 0;

    const reportChild = (result: ChildCollectionResult) => {
      if (roundClosed) {
        // The merge input is already read, so this is the only place the child is accounted for.
        recordOutcome(result.processName, 'timeout', result.durationSeconds);
        return;
      }
      reports.push(result);
    };

    const startedAt = Date.now();
    let work: Promise<unknown>;
    try {
      work = Promise.all([
        collectOwnSnapshot().then((text) => {
          ownText = text;
          ownSettled = true;
          ownDurationSeconds = (Date.now() - startedAt) / 1000;
        }),
        collectFromChildren(roundId, awaitChildReply(roundId), reportChild),
      ]);
    } catch (error) {
      // A collector throwing synchronously never produces the promise the deadline below races,
      // so `onRoundSettled` must be called here directly or `inFlight` never clears.
      logFromError(error, 'Error starting a metrics collection round');
      onRoundSettled();
      // The round never reached the merge below, so this is the only place it settles for us.
      // An exception, not a timeout: keeps the timeout counter meaningful for latency alone.
      recordOutcome(ownProcessName, 'error', (Date.now() - startedAt) / 1000);
      return { statusCode: 500, body: '' };
    }
    // Bound to `work`, not to the response: the merge can answer on the deadline while children
    // are still awaited, and releasing the round there would let the next scrape collect twice.
    void work.then(onRoundSettled, onRoundSettled);

    let deadlineTimer: NodeJS.Timeout | undefined;
    try {
      // Bounds the aggregate, not any single child: each per-child promise resolves on its own
      // within `collectTimeoutMs`, so this only fires when something else is slow.
      await Promise.race([
        work,
        new Promise<void>((resolve) => {
          deadlineTimer = setTimeout(resolve, roundDeadlineMs).unref();
        }),
      ]);
    } catch (error) {
      logFromError(error, 'Error collecting merged metrics snapshot');
      // Children still pending are settled by `forceTimeoutPending` below through `reportChild`'s
      // `roundClosed` branch — only ours is otherwise never recorded on this early return.
      // `work` rejecting is a real exception, never the deadline (the deadline timer only resolves).
      recordOutcome(ownProcessName, 'error', (Date.now() - startedAt) / 1000);
      return { statusCode: 500, body: '' };
    } finally {
      if (deadlineTimer) {
        clearTimeout(deadlineTimer);
      }
      // Closed before the pending children are released, so a late report cannot reach a merge
      // input that has already been read.
      roundClosed = true;
      forceTimeoutPending(roundId);
    }

    // A round deadline can elapse before our own snapshot resolves: excluded from the merge and
    // reported as a timeout, rather than coerced into an empty block by the `?? ''` below.
    const ownReport = ownSettled ? [{ processName: ownProcessName, text: ownText ?? '' }] : [];
    const { text, invalidProcesses, emptyProcesses, droppedFamilies, metadataConflicts } = mergeMetricsSnapshots([
      ...ownReport,
      ...reports.flatMap(({ processName, text: childText }) => (childText === undefined ? [] : [{ processName, text: childText }])),
    ]);

    // A `# TYPE` disagreement removes the family from the scrape, and a rejected process loses
    // every family it carried. A `# HELP`/`# UNIT` disagreement only picks the first text seen,
    // and reporting that at error level keeps an alert-on-any-error rule lit.
    if (invalidProcesses.length > 0 || droppedFamilies.length > 0) {
      logError('Rejected part of a metrics scrape while merging', { invalidProcesses, droppedFamilies });
    }
    // A family reported here can also be one `droppedFamilies` already dropped for a `# TYPE`
    // conflict — its metadata was never "kept", the whole family was discarded, so that name is
    // excluded rather than logged twice with two different fates.
    const droppedFamilyNames = new Set(droppedFamilies.map((family) => family.name));
    const survivingMetadataConflicts = metadataConflicts.filter((conflict) => !droppedFamilyNames.has(conflict.name));
    if (survivingMetadataConflicts.length > 0) {
      logTrace('Metric family metadata disagrees between producers, kept the first text seen', { metadataConflicts: survivingMetadataConflicts });
    }

    const invalidProcessNames = new Set(invalidProcesses);
    const emptyProcessNames = new Set(emptyProcesses);
    const resolveOutcome = (processName: string, reported: 'ok' | CollectionFailureReason): 'ok' | CollectionFailureReason => {
      if (reported !== 'ok') {
        return reported;
      }
      if (invalidProcessNames.has(processName)) {
        return 'invalid';
      }
      return emptyProcessNames.has(processName) ? 'empty' : 'ok';
    };

    for (const { processName, outcome, durationSeconds } of reports) {
      recordOutcome(processName, resolveOutcome(processName, outcome), durationSeconds);
    }
    // The parent's block faces the same validation as a child's, and the counters reporting its
    // rejection are inside the block being rejected.
    recordOutcome(ownProcessName, ownSettled ? resolveOutcome(ownProcessName, 'ok') : 'timeout', ownSettled ? ownDurationSeconds : (Date.now() - startedAt) / 1000);

    return { statusCode: 200, body: text };
  };

  // The floor advances at collection *start*, never completion, so it holds across a failed or
  // still-running collection.
  const startRound = (): Promise<CollectionResult> => {
    lastCollectionStartedAt = Date.now();
    let markRoundSettled: () => void = () => {};
    const roundSettled = new Promise<void>((resolve) => {
      markRoundSettled = resolve;
    });
    const response = runRound(markRoundSettled).then((result) => {
      cached = result;
      return result;
    });
    inFlight = response;
    void Promise.allSettled([response, roundSettled]).then(() => {
      inFlight = undefined;
    });
    return response;
  };

  const server = createServer((req, res) => {
    if (!isScrapeMethod(req.method)) {
      res.statusCode = 405;
      res.end();
      return;
    }
    if ((req.url ?? '').split('?')[0] !== METRICS_PATH) {
      res.statusCode = 404;
      res.end();
      return;
    }

    void (async () => {
      let result: CollectionResult;
      if (inFlight) {
        result = await inFlight;
      } else if (cached && (Date.now() - lastCollectionStartedAt) < minIntervalMs) {
        result = cached;
      } else {
        result = await startRound();
      }

      res.statusCode = result.statusCode;
      if (result.statusCode === 200) {
        res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        // HEAD responses must carry no body, even for a successful scrape.
        res.end(req.method === 'HEAD' ? undefined : result.body);
      } else {
        res.end();
      }
    })().catch((error: unknown) => {
      // An unhandled rejection here would reach the process manager from an unauthenticated route.
      logFromError(error, 'Failed to answer a metrics scrape');
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end();
      }
    });
  });

  server.on('error', (err) => {
    logFromError(err, 'Metrics server error');
  }).unref();

  server.listen(port, host, () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- server is listening on a TCP port, never a pipe, at this point
    const address = server.address() as AddressInfo;
    logTrace(`Metrics server listening on ${address.address}:${address.port}`);
    if (publicPort !== undefined && publicPort !== address.port) {
      logTrace(`Metrics server public port ${publicPort}`);
    }
  }).unref();

  return { server, handleReply, abandonPendingReply };
};
