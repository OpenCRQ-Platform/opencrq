// tracing needs to be imported first through a require
/* eslint-disable import/first */
// eslint-disable-next-line import/no-commonjs
require('./tracing');

import type { ChildProcess } from 'node:child_process';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { uuidv7 } from 'uuidv7';
import type { RemoteEntitlement } from './features/edition/entitlement-ipc';
import type { HealthStatus } from './utils/health-check';
import { getProcessName, pmConfig } from './config';
import { collectMetricsSnapshot, stopTelemetry } from './tracing';
import { onHealthReport } from './utils/health-check';
import { createLogger } from './utils/logger';
import { onRemoteEntitlementGranted, sendRemoteEntitlement } from './features/edition/entitlement-ipc';
import { onMetricsCollected, sendMetricsCollect } from './utils/metrics-ipc';
import { createMetricsServer } from './utils/metrics-server';
import { recordCollectionOutcome, registerProcessSupervisionMetrics } from './utils/pm-metrics';
import { findReservedProcessNameCollision } from './utils/process-profile';

const logger = createLogger();
const { logTrace, logError, logFromError, logFatalError } = logger;

// One id per start of the process manager, shared by all its children.
const bootId = uuidv7();

let stopping = false;
let childrenSigkillTimeout: NodeJS.Timeout | undefined;

logTrace('Process Manager is starting', {
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  dev: pmConfig.inDev,
  nodejs: process.version,
});

interface ChildHealth {
  status: HealthStatus,
  lastHeartbeat: number,
}

type StopProcessManager = (onStop?: () => void, onAlreadyStopping?: () => void) => void;

interface ChildProcessControl {
  stop: () => void,
  forceStop: () => void,
  onExit: (stopProcessManager: StopProcessManager) => void,
  onError: (stopProcessManager: StopProcessManager) => void,
}

const children = new Map<string, ChildHealth>();
// A child's process reference never changes for its lifetime, only its status does.
const childProcessRefs = new Map<string, ChildProcess>();
let metricsServer: ReturnType<typeof createMetricsServer> | undefined;

const updateChildrenHealthState = (processName: string, status: HealthStatus) => {
  children.set(processName, { status, lastHeartbeat: Date.now() });
};

const checkFinalCleanup = async () => {
  const allChildrenFinished = Array.from(children.values()).every(
    (h) => h.status === 'EXITED',
  );

  if (stopping && allChildrenFinished) {
    logTrace('All children exited. Final cleanup...');

    const signal = AbortSignal.timeout(30_000);
    signal.addEventListener('abort', () => {
      logError('Force process exit');
      process.exit();
    });

    if (childrenSigkillTimeout) {
      clearTimeout(childrenSigkillTimeout);
    }
    if (metricsServer) {
      // A scraper's idle keep-alive otherwise holds `close()` until the 30 s force-exit above,
      // and `stopTelemetry` never runs.
      metricsServer.server.closeAllConnections();
      await new Promise<void>((resolve) => metricsServer?.server.close(() => resolve()));
    }
    try {
      await stopTelemetry(signal);
    } catch (e) {
      logFromError(e, 'Error during final telemetry stop');
    }
  }
};

/**
 * Fans a child's remote entitlement out to its siblings. Only the process that
 * registers with XTM One learns the answer, and every other one gates on it.
 */
const relayRemoteEntitlement = (from: string, entitlement: RemoteEntitlement) => {
  for (const [processName, child] of childProcessRefs.entries()) {
    if (processName !== from) {
      sendRemoteEntitlement(child, entitlement);
    }
  }
};

const startChild = (processName: string, { script, memory }: { script: string, memory: number }): ChildProcessControl | undefined => {
  logTrace('Starting process', { processName, script, memory });

  const child = fork(
    path.join(__dirname, script),
    {
      execArgv: [
        `--max-old-space-size=${memory}`,
        '--enable-source-maps',
        '--import',
        pathToFileURL(path.join(__dirname, 'tracing.mjs')).href,
      ],
      env: { ...process.env, PROCESS_NAME: processName, BOOT_ID: bootId },
    },
  );

  if (child.pid) {
    childProcessRefs.set(processName, child);
    updateChildrenHealthState(processName, 'BOOTING');
    logTrace('Process started', { processName });

    child.on('message', onHealthReport((status) => updateChildrenHealthState(processName, status)));
    child.on('message', onRemoteEntitlementGranted((entitlement) => relayRemoteEntitlement(processName, entitlement)));

    // `metricsEnabled` is declared below, after the collision guards it folds in.
    if (metricsEnabled) {
      child.on('message', onMetricsCollected((roundId, text, oversized) => metricsServer?.handleReply(processName, roundId, text, oversized)));
    }

    return {
      stop: () => {
        if (child.connected) {
          logTrace('Sending shutdown message to child process', { processName });
          child.send('shutdown');
        } else {
          logTrace('Child process not connected, sending SIGTERM', { processName });
          child.kill('SIGTERM');
        }
      },
      forceStop: () => {
        child.kill('SIGKILL');
      },
      onExit: (stopProcessManager) => {
        child.on('exit', async (code, signal) => {
          updateChildrenHealthState(processName, 'EXITED');
          childProcessRefs.delete(processName);
          stopProcessManager(
            () => {
              logError('Process unexpectedly exited, stopping sibling processes', { processName, script, code, signal });
              process.exitCode = code || 1; // ensure exit code will be different from 0
            },
            () => logTrace('Process exited', { processName, script, code, signal }),
          );
          await checkFinalCleanup();
        });
      },
      onError: (stopProcessManager) => {
        child.on('error', (err) => {
          updateChildrenHealthState(processName, 'ERROR');
          stopProcessManager(
            () => {
              logFromError(err, 'Process unexpectedly emitted an error, stopping sibling processes', { processName, script });
              process.exitCode = 1;
            },
            () => logFromError(err, 'Process unexpectedly emitted an error, stopping sibling processes already in progress', { processName, script }),
          );
        });
      },
    };
  } else {
    logError('Error while starting process', { processName });
    return undefined;
  }
};

const isHealthy = () => {
  if (children.size === 0) {
    return false;
  }

  const now = Date.now();
  for (const [processName, health] of children) {
    if (health.status !== 'RUNNING') {
      logTrace('Unhealthy child status', { processName, status: health.status });
      return false;
    }
    if (now - health.lastHeartbeat > pmConfig.process_manager.heartbeat_timeout) {
      logTrace('Child heartbeat timeout', { processName, lastHeartbeat: health.lastHeartbeat });
      return false;
    }
  }
  return true;
};

const startHealthCheckServer = () => {
  const server = createServer((_, res) => {
    const healthy = isHealthy();
    const childrenHealthStates = Array.from(children.entries()).map(([processName, health]) => ({
      processName,
      status: health.status,
      lastHeartbeat: new Date(health.lastHeartbeat),
    }));

    res.statusCode = healthy ? 200 : 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ healthy, childrenHealthStates }));
  });

  server.on('error', (err) => {
    logFromError(err, 'Healthcheck server error');
  }).unref();

  const publicPort = pmConfig.healthcheck_http_server.public_port;
  const port = pmConfig.healthcheck_http_server.port;
  server.listen(port, () => {
    logTrace(`Healthcheck server listening on port ${port}`);
    if (publicPort !== port) {
      logTrace(`Healthcheck server public port ${publicPort}`);
    }
  }).unref();
};

const startMetricsServer = () => {
  const prometheus = pmConfig.telemetry?.observability.prometheus;
  if (!prometheus?.enabled) {
    return;
  }
  const {
    host, port, public_port: publicPort,
    min_interval_ms: minIntervalMs, collect_timeout_ms: collectTimeoutMs,
    round_deadline_ms: roundDeadlineMs, max_reply_bytes: maxReplyBytes,
  } = prometheus;

  metricsServer = createMetricsServer({
    host,
    port,
    publicPort,
    ownProcessName: getProcessName(),
    minIntervalMs,
    collectTimeoutMs,
    roundDeadlineMs,
    maxReplyBytes,
    collectOwnSnapshot: collectMetricsSnapshot,
    recordOutcome: recordCollectionOutcome,
    collectFromChildren: async (roundId, awaitChildReply, reportChild) => {
      await Promise.all(Array.from(children.entries()).map(async ([processName, health]) => {
        if (health.status !== 'RUNNING') {
          reportChild({ processName, outcome: 'not_running', durationSeconds: 0 });
          return;
        }
        const child = childProcessRefs.get(processName);
        if (!child || !child.connected) {
          reportChild({ processName, outcome: 'not_connected', durationSeconds: 0 });
          return;
        }

        const startedAt = Date.now();
        if (!sendMetricsCollect(child, roundId)) {
          reportChild({ processName, outcome: 'send_error', durationSeconds: (Date.now() - startedAt) / 1000 });
          return;
        }

        // Nothing else settles a child that dies here: it has already passed the connected check
        // above, so the round would wait out the per-child timeout and name the wrong cause.
        const settleOnExit = () => metricsServer?.abandonPendingReply(processName, roundId);
        child.once('disconnect', settleOnExit);
        child.once('exit', settleOnExit);

        const reply = await awaitChildReply(processName);
        child.off('disconnect', settleOnExit);
        child.off('exit', settleOnExit);

        const durationSeconds = (Date.now() - startedAt) / 1000;
        if (reply.outcome === 'ok') {
          reportChild({ processName, outcome: 'ok', durationSeconds, text: reply.text });
          return;
        }
        reportChild({ processName, outcome: reply.outcome, durationSeconds });
      }));
    },
  });
};

logTrace('Starting Process Manager');

const processManagerProfile = pmConfig.process_manager.profile;
const processes = pmConfig.process_manager[processManagerProfile];

if (!processes) {
  // can exit immediately has no fork has been done yet
  logFatalError('Process manager profile not found in configuration', { processManagerProfile });
}

// A child named after the process manager collides with the parent's own identity label, and a
// scrape port already taken by the health endpoint never binds. Either withholds the metrics
// endpoint, never the platform.
const reservedProcessNameCollision = findReservedProcessNameCollision(Object.keys(processes), getProcessName());
if (reservedProcessNameCollision) {
  logError('Process profile names a child after the process manager\'s own reserved name; metrics endpoint disabled', { processName: reservedProcessNameCollision });
}

const prometheusConfig = pmConfig.telemetry?.observability.prometheus;
const metricsPortCollision = prometheusConfig?.enabled === true && prometheusConfig.port === pmConfig.healthcheck_http_server.port;
if (metricsPortCollision) {
  logError('Metrics scrape port is already the healthcheck port; metrics endpoint disabled', { port: pmConfig.healthcheck_http_server.port });
}

// The single source of truth for whether the metrics endpoint runs this boot: computed once,
// against all three conditions, before any child is forked or the endpoint itself is started.
const metricsEnabled = prometheusConfig?.enabled === true && !reservedProcessNameCollision && !metricsPortCollision;

Object.keys(processes).forEach((processName) => {
  updateChildrenHealthState(processName, 'FORKING');
});

let hasChildProcessStartError = false;

const childProcesses = Object.entries(processes)
  .map(([processName, processConfig]) => {
    const childProcess = startChild(processName, { script: processConfig.script, memory: processConfig.memory });
    if (childProcess === undefined) {
      updateChildrenHealthState(processName, 'ERROR');
      hasChildProcessStartError = true;
    }
    return childProcess;
  })
  .filter((childProcess): childProcess is ChildProcessControl => childProcess !== undefined);

const stopProcessManager: StopProcessManager = (onStop, onAlreadyStopping) => {
  if (!stopping) {
    stopping = true;

    onStop?.();

    childProcesses.forEach((process) => process.stop());

    childrenSigkillTimeout = setTimeout(() => {
      logError('Processes did not stop after 30 seconds, sending SIGKILL');
      childProcesses.forEach((process) => process.forceStop());
    }, 30_000).unref();
  } else {
    onAlreadyStopping?.();
  }
};

childProcesses.forEach(({ onExit, onError }) => {
  onExit(stopProcessManager);
  onError(stopProcessManager);
});

// Unconditional: a stack cannot say whether a failure is telemetry's, since the build inlines
// every module into one bundle per entry point. Telemetry contains its own failures at each
// call site instead.
const stopOnFatal = (error: unknown, message: string) => {
  logFromError(error, message);
  process.exitCode = 1;
  stopProcessManager();
};

process.on('uncaughtException', (error) => stopOnFatal(error, 'Uncaught exception in process manager, stopping'));
process.on('unhandledRejection', (reason) => stopOnFatal(reason, 'Unhandled rejection in process manager, stopping'));

startHealthCheckServer();
// Not gated on the scrape endpoint: supervision state is a fact about the children, and an
// OTLP-only deployment must see it too. `opencrq.pm.collection.{ok,duration,failures}`,
// recorded via `recordOutcome` inside startMetricsServer below, measure the scrape collection
// loop instead, so they exist only when it runs.
registerProcessSupervisionMetrics(() => children);
if (metricsEnabled) {
  try {
    startMetricsServer();
  } catch (error) {
    // A throw here would skip the signal registration below, leaving the supervisor deaf to SIGTERM.
    logFromError(error, 'Failed to start the metrics endpoint; the platform continues without it');
  }
}

if (hasChildProcessStartError) {
  stopProcessManager(() => {
    logTrace('Some children had startup errors, stopping server...');
  });
}

['SIGTERM', 'SIGINT'].forEach((signal) => {
  process.on(signal, () => {
    stopProcessManager(
      () => logTrace(`${signal} signal received, stopping server...`),
      () => logTrace(`${signal} signal received, stopping server already in progress...`),
    );
  });
});
