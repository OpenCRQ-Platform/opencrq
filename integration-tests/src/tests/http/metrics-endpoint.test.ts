import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { onHealthReport } from '@app/back/src/utils/health-check';
import { getWorkerDbName, pgConfig } from '../../setup/pg-config';

// Mocked so this parent (test-runner) process never imports config.ts through `./logger` —
// unlike the real spawned children below, it has no application config of its own to parse.
vi.mock('@app/back/src/utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logError: vi.fn(), logFromError: vi.fn() }),
}));

const { onMetricsCollected, sendMetricsCollect } = await import('@app/back/src/utils/metrics-ipc');
const { createMetricsServer } = await import('@app/back/src/utils/metrics-server');

// Side effect only: ensures this worker's dedicated test database exists (cloned from the
// migrated template) before `spawnRealEntryChild` points a real backend process at it.
await import('../../setup/db');

// This suite spawns real child processes against back's built dist output, because the
// metrics-collect handshake only exists across a process boundary.
const backRoot = path.dirname(createRequire(import.meta.url).resolve('@app/back/package.json'));
const tracingImportUrl = pathToFileURL(path.join(backRoot, 'dist', 'tracing.mjs')).href;
const workerEntryPath = path.join(backRoot, 'dist', 'index-worker.mjs');
const backendIsBuilt = existsSync(workerEntryPath);

// `describe.skipIf` below silently omits its tests from the default reporter's output — logged
// unconditionally, outside the describe it gates, so a local run without a build says why.
if (!backendIsBuilt && !process.env.CI) {
  // eslint-disable-next-line no-console -- the only visible signal a plain `yarn test` gives for this skip
  console.warn('[metrics-endpoint.test.ts] Skipped: back is not built. Run `yarn workspace @app/back build` first.');
}

const childEnv = (processName: string): NodeJS.ProcessEnv => ({
  ...process.env,
  PROCESS_NAME: processName,
  // Forces back's config.ts environment resolution to 'production' (default.json +
  // env vars only), independently of vitest's own NODE_ENV=test — an isolated, deterministic config.
  ENV: 'production',
  HEALTHCHECK_HTTP_SERVER__PORT: '0',
  // Deliberately not 'split'/'monolith': process names used by these fixtures (e.g. 'childa',
  // 'push-only-child') aren't in either profile, so `config()` would fail to resolve them
  // regardless — only the tracing bootstrap and metrics IPC below depend on this env, not `config()`.
  PROCESS_MANAGER__PROFILE: 'metrics-integration-test',
  PROCESS_MANAGER__HEARTBEAT_TIMEOUT: '60000',
  TELEMETRY__OBSERVABILITY__SERVICE_NAME: 'metrics-integration-test',
  TELEMETRY__OBSERVABILITY__PROMETHEUS__ENABLED: 'true',
  // Required by the production config schema; only the http process registers, so nothing dials it.
  XTM_ONE__URL: 'http://127.0.0.1:1',
  XTM_ONE__TOKEN: 'metrics-integration-test',
  XTM_ONE__PLATFORM_URL: 'http://127.0.0.1:1',
});

// Spawned with `-e` rather than a fixture script: the SDK bootstrap and metrics IPC wiring come
// entirely from `--import`, so the child only has to stay alive over the IPC channel.
const spawnFixtureChild = (processName: string): ChildProcess => spawn(process.execPath, [
  '--import', tracingImportUrl,
  '-e', 'setInterval(() => {}, 1_000);',
], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: childEnv(processName) });

// Forks the real built `index-worker.mjs`, exactly as index-pm.ts forks its own children — unlike
// `spawnFixtureChild`, this goes through `config()`, so it needs a process name registered under a
// real profile ('worker' under 'split') plus a reachable Postgres, or it dies at import time before
// ever reaching the code this test means to exercise. Points at this vitest worker's own dedicated
// test database (see the `setup/db` import above) rather than a throwaway one, since `index-worker`
// runs real migrations against whatever it's given.
const spawnRealEntryChild = (processName: string, envOverrides: NodeJS.ProcessEnv = {}): ChildProcess => spawn(process.execPath, [
  '--import', tracingImportUrl,
  workerEntryPath,
], {
  // config.ts resolves `config/default.json` against `INIT_CWD` (set by yarn to wherever `yarn
  // vitest` was invoked from, e.g. `integration-tests/`) in preference to `process.cwd()` — so
  // both need overriding here, or `default.json`'s `process_manager` profiles never load and
  // `getConfig()` fails regardless of which profile/process name is set.
  cwd: backRoot,
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  env: {
    ...childEnv(processName),
    INIT_CWD: backRoot,
    PROCESS_MANAGER__PROFILE: 'split',
    POSTGRES__HOST: pgConfig.host,
    POSTGRES__PORT: String(pgConfig.port),
    POSTGRES__USER: pgConfig.user,
    POSTGRES__PASSWORD: pgConfig.password,
    POSTGRES__DATABASE: getWorkerDbName(),
    ...envOverrides,
  },
});

// `assertPortClosed` resolves almost instantly (ECONNREFUSED on a loopback connect), fast enough
// to win a race against the child's own 'exit' event even when the child already crashed a moment
// earlier — a crash notification takes a few event-loop turns longer to arrive than a refused TCP
// connect. Waiting for the child's own first health-status heartbeat (sent right after `config()`
// resolves inside `boot()`) is a real signal that it got past process/config resolution, unlike a
// fixed delay or the port check's own timing.
const waitForHealthStatus = (child: ChildProcess, timeoutMs: number): Promise<void> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms waiting for a health status message from the child`)), timeoutMs);
  child.on('message', onHealthReport(() => {
    clearTimeout(timer);
    resolve();
  }));
});

// Watches a child from the moment it's spawned — not from whenever the first assertion happens to
// run — so a crash that lands between spawn and that first `await` is still caught. Otherwise a
// child that crashes early (e.g. on a config or DB error) makes an assertion like "no port opened"
// pass for the wrong reason instead of failing loudly.
const watchForCrash = (child: ChildProcess) => {
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  let exitInfo: { code: number | null, signal: NodeJS.Signals | null } | undefined;
  child.once('exit', (code, signal) => {
    exitInfo = { code, signal };
  });

  return {
    assertWhileAlive: <T>(resolveOn: Promise<T>): Promise<T> => {
      if (exitInfo) {
        return Promise.reject(new Error(`Child process already exited (code=${exitInfo.code}, signal=${exitInfo.signal}) before the assertion started. Stderr:\n${stderr}`));
      }
      const exited = new Promise<never>((_resolve, reject) => {
        child.once('exit', (code, signal) => {
          reject(new Error(`Child process exited (code=${code}, signal=${signal}) before the assertion completed. Stderr:\n${stderr}`));
        });
      });
      return Promise.race([resolveOn, exited]);
    },
  };
};

// Resolves once the connection attempt is refused (nothing listening); rejects if it succeeds or
// fails for any other reason, so this only ever confirms "no port opened", never masks a different failure.
// Bounded by its own timeout rather than relying solely on the outer test timeout, so a dropped
// SYN (neither a connect nor an error event) fails fast with a clear cause.
const assertPortClosed = (port: number, timeoutMs = 3_000): Promise<void> => new Promise((resolve, reject) => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  const timer = setTimeout(() => {
    socket.destroy();
    reject(new Error(`Timed out after ${timeoutMs}ms waiting for a connection attempt to port ${port} to settle`));
  }, timeoutMs);
  socket.once('connect', () => {
    clearTimeout(timer);
    socket.destroy();
    reject(new Error(`Unexpected TCP connection succeeded on port ${port}`));
  });
  socket.once('error', (error: NodeJS.ErrnoException) => {
    clearTimeout(timer);
    if (error.code === 'ECONNREFUSED') {
      resolve();
    } else {
      reject(error);
    }
  });
});

const waitForStdout = (child: ChildProcess, pattern: string, timeoutMs: number): Promise<string> => new Promise((resolve, reject) => {
  let buffer = '';
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${pattern}" in child stdout. Got:\n${buffer}`)), timeoutMs);
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    if (buffer.includes(pattern)) {
      clearTimeout(timer);
      resolve(buffer);
    }
  });
});

const waitForExit = (child: ChildProcess): Promise<void> => new Promise((resolve) => {
  child.once('exit', () => resolve());
});

// Skipped when the backend is not built, but never in CI, where the build is a declared step and
// a missing bundle means the pipeline is broken rather than the workstation.
describe.skipIf(!backendIsBuilt && !process.env.CI)('Metrics Endpoint (HTTP)', () => {
  const spawnedChildren: Array<ChildProcess> = [];

  beforeAll(() => {
    expect(backendIsBuilt, 'back is not built — run `yarn workspace @app/back build`').toBe(true);
  });

  afterEach(() => {
    while (spawnedChildren.length > 0) {
      spawnedChildren.pop()?.kill('SIGKILL');
    }
  });

  it('opens no scrape port when only the push (OTLP) transport is enabled', async () => {
    // `worker` under the `split` profile, not a synthetic name: needs `config()` to resolve for
    // real, since it runs the full worker boot rather than just the tracing bootstrap.
    const child = spawnRealEntryChild('worker', {
      TELEMETRY__OBSERVABILITY__PROMETHEUS__ENABLED: 'false',
      TELEMETRY__OBSERVABILITY__OTLP__METRICS__ENABLED: 'true',
      TELEMETRY__OBSERVABILITY__OTLP__METRICS__EXPORTER: 'http://127.0.0.1:4317',
    });
    spawnedChildren.push(child);
    const { assertWhileAlive } = watchForCrash(child);

    await assertWhileAlive(waitForStdout(child, 'OpenTelemetry SDK started successfully', 20_000));
    await assertWhileAlive(waitForHealthStatus(child, 20_000));

    await assertWhileAlive(assertPortClosed(14269));
  }, 30_000);

  it('keeps the response valid, with every remaining process, after one child is killed', async () => {
    const childA = spawnFixtureChild('childa');
    const childB = spawnFixtureChild('childb');
    spawnedChildren.push(childA, childB);

    await Promise.all([
      waitForStdout(childA, 'OpenTelemetry SDK started successfully', 20_000),
      waitForStdout(childB, 'OpenTelemetry SDK started successfully', 20_000),
    ]);

    const outcomes: Array<{ processName: string, outcome: string }> = [];
    const children = new Map<string, ChildProcess>([['childa', childA], ['childb', childB]]);

    const metricsServer = createMetricsServer({
      host: '127.0.0.1',
      port: 0,
      ownProcessName: 'pm',
      minIntervalMs: 0,
      collectTimeoutMs: 3_000,
      roundDeadlineMs: 5_000,
      maxReplyBytes: 2 * 1024 * 1024,
      collectOwnSnapshot: () => Promise.resolve(''),
      recordOutcome: (processName, outcome) => outcomes.push({ processName, outcome }),
      collectFromChildren: async (roundId, awaitChildReply, reportChild) => {
        await Promise.all(Array.from(children.entries()).map(async ([processName, child]) => {
          if (!child.connected || !sendMetricsCollect(child, roundId)) {
            reportChild({ processName, outcome: 'not_connected', durationSeconds: 0 });
            return;
          }
          const reply = await awaitChildReply(processName);
          if (reply.outcome === 'ok') {
            reportChild({ processName, outcome: 'ok', durationSeconds: 0, text: reply.text });
          } else {
            reportChild({ processName, outcome: reply.outcome, durationSeconds: 0 });
          }
        }));
      },
    });

    try {
      for (const [processName, child] of children) {
        child.on('message', onMetricsCollected((roundId, text, oversized) => metricsServer.handleReply(processName, roundId, text, oversized)));
      }

      await new Promise<void>((resolve) => metricsServer.server.on('listening', () => resolve()));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- server is listening on a TCP port, never a pipe, at this point
      const { port } = metricsServer.server.address() as { port: number };
      const url = `http://127.0.0.1:${port}/metrics`;

      const firstResponse = await fetch(url);
      const firstBody = await firstResponse.text();
      expect(firstResponse.status).toBe(200);
      expect(firstBody).toContain('process_name="childa"');
      expect(firstBody).toContain('process_name="childb"');

      // Proves runtime series stay per-process rather than aggregated: both children's
      // process_memory_usage samples are present, each tagged by its own process_name.
      const processMemoryUsageLines = firstBody.split('\n').filter((line) => line.startsWith('process_memory_usage'));
      expect(processMemoryUsageLines.some((line) => line.includes('process_name="childa"'))).toBe(true);
      expect(processMemoryUsageLines.some((line) => line.includes('process_name="childb"'))).toBe(true);

      childA.kill('SIGKILL');
      await waitForExit(childA);

      const secondResponse = await fetch(url);
      const secondBody = await secondResponse.text();

      expect(secondResponse.status).toBe(200);
      expect(secondBody).toContain('process_name="childb"');
      expect(secondBody).not.toContain('process_name="childa"');
      expect(outcomes).toContainEqual({ processName: 'childa', outcome: 'not_connected' });
    } finally {
      await new Promise<void>((resolve) => metricsServer.server.close(() => resolve()));
    }
  }, 30_000);

  it('settles the round on a child killed after the collect was sent, without waiting out its timeout', async () => {
    // Spawned without `--import`, so it installs no metrics-collect handler and never replies:
    // the only thing that can settle its pending entry is its own exit.
    const silentChild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000);'], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: childEnv('silent'),
    });
    spawnedChildren.push(silentChild);

    const outcomes: Array<{ processName: string, outcome: string }> = [];
    const collectTimeoutMs = 10_000;

    const metricsServer = createMetricsServer({
      host: '127.0.0.1',
      port: 0,
      ownProcessName: 'pm',
      minIntervalMs: 0,
      collectTimeoutMs,
      roundDeadlineMs: 20_000,
      maxReplyBytes: 2 * 1024 * 1024,
      collectOwnSnapshot: () => Promise.resolve(''),
      recordOutcome: (processName, outcome) => outcomes.push({ processName, outcome }),
      collectFromChildren: async (roundId, awaitChildReply, reportChild) => {
        sendMetricsCollect(silentChild, roundId);
        const settleOnExit = () => metricsServer.abandonPendingReply('silent', roundId);
        silentChild.once('disconnect', settleOnExit);
        silentChild.once('exit', settleOnExit);

        const reply = await awaitChildReply('silent');
        reportChild({ processName: 'silent', outcome: reply.outcome === 'ok' ? 'ok' : reply.outcome, durationSeconds: 0 });
      },
    });

    try {
      await new Promise<void>((resolve) => metricsServer.server.on('listening', () => resolve()));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- server is listening on a TCP port, never a pipe, at this point
      const { port } = metricsServer.server.address() as { port: number };

      const startedAt = Date.now();
      setTimeout(() => silentChild.kill('SIGKILL'), 200);
      const response = await fetch(`http://127.0.0.1:${port}/metrics`);
      await response.text();

      expect(response.status).toBe(200);
      expect(Date.now() - startedAt).toBeLessThan(collectTimeoutMs);
      expect(outcomes).toContainEqual({ processName: 'silent', outcome: 'not_connected' });
    } finally {
      await new Promise<void>((resolve) => metricsServer.server.close(() => resolve()));
    }
  }, 30_000);
});
