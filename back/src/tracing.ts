import type { DiagLogger, Exception } from '@opentelemetry/api';
import { diag, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { setGlobalErrorHandler } from '@opentelemetry/core';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import type { MetricReader } from '@opentelemetry/sdk-metrics';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { ATTR_SERVICE_INSTANCE_ID } from '@opentelemetry/semantic-conventions/incubating';
import Pyroscope from '@pyroscope/nodejs';
import { getProcessName, pmConfig } from './config';
import { abortOnSignal } from './utils';
import { createLogger } from './utils/logger';
import { onMetricsCollect, sendMetricsSnapshot } from './utils/metrics-ipc';
import { createSnapshotReader } from './utils/metrics-snapshot';
import { dbOperationDurationView, droppedInstrumentViews, gcDurationView } from './utils/metrics-views';
import { platformVersion } from './utils/platform-version';

const { logTrace, logError, logFromError } = createLogger({ engine: 'telemetry' });

// The SDK reports failures through two channels, both no-ops until something is registered: an
// exception goes to the global error handler, everything else to the diagnostics logger.
const TELEMETRY_ERROR_REPEAT_MS = 5 * 60_000;

interface TelemetryErrorWindow {
  loggedAt: number,
  suppressed: number,
}

const telemetryErrorWindows = new Map<string, TelemetryErrorWindow>();

// A type alias, not an interface: only the former gets the implicit index signature that the
// logger's data parameter requires.
type TelemetryErrorReport = {
  suppressed: number,
  suppressedSince: string,
};

// Keyed with expiry, not a single slot: one slot logs on every tick once two exporters fail
// concurrently, and never logs a recurrence, since success reaches no channel observable here.
// Returns what the caller must attach to the line it is about to log, or undefined while the
// window is still open: a recurrence stating no count reads as a single failure whatever the
// real rate, which is all the reader has to judge a sustained outage on.
const claimTelemetryErrorWindow = (key: string): TelemetryErrorReport | undefined => {
  const now = Date.now();
  const previous = telemetryErrorWindows.get(key);
  if (previous && now - previous.loggedAt < TELEMETRY_ERROR_REPEAT_MS) {
    previous.suppressed += 1;
    return undefined;
  }

  // Read before the sweep, so an expired window can be dropped whatever its count: this key
  // carries its own count out on the line below, and no other key has anything left to report,
  // nothing firing at expiry. The map therefore holds only the failures seen in the last window.
  for (const [seenKey, window] of telemetryErrorWindows) {
    if (now - window.loggedAt >= TELEMETRY_ERROR_REPEAT_MS) {
      telemetryErrorWindows.delete(seenKey);
    }
  }

  telemetryErrorWindows.set(key, { loggedAt: now, suppressed: 0 });
  return {
    suppressed: previous?.suppressed ?? 0,
    suppressedSince: new Date(previous?.loggedAt ?? now).toISOString(),
  };
};

// Nothing to say on a first occurrence, and an all-zero payload on every recurrence would drown
// the count that matters.
const suppressionData = (report: TelemetryErrorReport) => (report.suppressed > 0 ? report : undefined);

// Guards the diagnostics channel alone, the only one a stack can reach: an exception stringified
// by another copy of core arrives there whole, and its frames, which differ on every tick, would
// defeat the throttle above. Both spellings are stripped, escaped frames carrying the two
// characters \ and n, and a frame stops at a quote, the fields that follow the stack in such a
// payload being what keeps two distinct failures apart.
const stripStackFrames = (text: string): string => text.replace(/(?:\\n|\n)\s*at\s[^\n"]*?(?=\\n|\n|"|$)/g, '');

// The SDK's own call sites (e.g. PeriodicExportingMetricReader) always pass the actual failure
// as an extra arg after a fixed template message, so the dedup key and the logged detail must
// both be derived from these args — keying on `message` alone would collapse every distinct
// failure into the same generic line.
const describeDiagArgs = (args: Array<unknown>): string => args
  .map((arg) => (arg instanceof Error ? arg.message : String(arg)))
  .join(' ');

const telemetryDiagLogger: DiagLogger = {
  error: (message: string, ...args: Array<unknown>) => {
    // Stripped on the argument-less shape alone, the only one a stringified exception takes: every
    // other call passes the failure beside a template message, of which `describeDiagArgs` keeps
    // just the message, so a line reading as a frame there is content and telling failures apart.
    const key = args.length > 0 ? `${message} ${describeDiagArgs(args)}` : stripStackFrames(message);
    const report = claimTelemetryErrorWindow(key);
    if (!report) {
      return;
    }

    const errorArg = args.find((arg): arg is Error => arg instanceof Error);
    if (errorArg) {
      logFromError(errorArg, message, suppressionData(report));
    } else if (args.length > 0) {
      logError(`${message} ${describeDiagArgs(args)}`, suppressionData(report));
    } else {
      logError(message, suppressionData(report));
    }
  },
  warn: () => {},
  info: () => {},
  debug: () => {},
  verbose: () => {},
};

// `Exception` is a contract rather than a class, so a non-Error one is a plain object holding any
// of name/code/message. Reading those three, instead of serializing the whole value, is what keeps
// an unserializable exception from silencing the failure it describes: a circular property throws
// out of JSON.stringify, and `globalErrorHandler` swallows that throw along with the report.
const describeException = (exception: Exception): string => {
  if (typeof exception === 'string') {
    return exception;
  }

  const { name, code, message } = exception;
  return [name, code, message].filter((part) => part !== undefined && part !== '').join(' ') || 'unknown exception';
};

// core's default handler stringifies the exception, stack included, into a `diag.error` message
// carrying no argument, which erases both the error object and any stable key it could be throttled
// on. Taking the handler keeps the exception itself.
const telemetryErrorHandler = (exception: Exception) => {
  const description = describeException(exception);
  const report = claimTelemetryErrorWindow(description);
  if (!report) {
    return;
  }

  if (exception instanceof Error) {
    try {
      logFromError(exception, 'OpenTelemetry SDK failure', suppressionData(report));
    } catch {
      // core swallows a throw out of this delegate together with the report it carried, so the
      // failure has to survive its own logging: `errorToObject` walks `cause` with no cycle guard.
      logError(description, suppressionData(report));
    }
    return;
  }

  logError(description, suppressionData(report));
};

interface TelemetryCallback {
  feature: string,
  callBack: () => Promise<void>,
}

const stopCallbacks: Array<TelemetryCallback> = [];

const registerTelemetryStop = (label: string, callBack: () => Promise<void>) => {
  stopCallbacks.push({ feature: label, callBack });
};

// Set inside initTelemetry() only when the prometheus reader was built; this is how the process
// manager collects its own metrics in-process (same bundle, no IPC) and how the child's
// collect-message handler below gets a document to reply with.
let collectSnapshot: (() => Promise<string>) | undefined;

export const collectMetricsSnapshot = async (): Promise<string> => (collectSnapshot ? collectSnapshot() : '');

export const stopTelemetry = async (signal: AbortSignal) => {
  await abortOnSignal(
    // allSettled to be sure every callback are executed even if one fails
    Promise.allSettled(
      stopCallbacks.map(async ({ feature, callBack }) => {
        try {
          logTrace('Stopping telemetry feature...', { feature });
          await callBack();
        } catch (error) {
          logFromError(error, 'Error stopping telemetry feature', { feature });
          throw { label: feature, error };
        }
        logTrace('Telemetry feature successfully stopped', { feature });
      }),
    ),
    signal,
  );
};

const initTelemetry = () => {
  if (!pmConfig.telemetry) {
    return;
  }

  const { service_name: serviceName, otlp, prometheus, pyroscope } = pmConfig.telemetry.observability;

  const processName = getProcessName();
  const pid = process.pid.toString();

  if (otlp.traces.enabled || otlp.metrics.enabled || prometheus.enabled || otlp.logs.enabled) {
    const serviceInstanceId = `${processName}-${pid}`;
    logTrace('Register OpenTelemetry', { serviceName, serviceInstanceId });

    // Installed before anything below is constructed: a failing instrumentation constructor and
    // an unknown instrumentation name are both reported through `diag`.
    diag.setLogger(telemetryDiagLogger, DiagLogLevel.ERROR);
    setGlobalErrorHandler(telemetryErrorHandler);

    // Construction is inside the try, not only `sdk.start()`: a malformed destination throws out
    // of the gRPC exporter's URL parsing, before the process manager installs its own handlers.
    try {
      const sdkConfig: Partial<NodeSDKConfiguration> = {
        resource: resourceFromAttributes({
          [ATTR_SERVICE_NAME]: serviceName,
          [ATTR_SERVICE_INSTANCE_ID]: serviceInstanceId,
          [ATTR_SERVICE_VERSION]: platformVersion(),
          'process.name': processName,
        }),
        // Both pinned explicitly: host-metrics sits in the resolver's default exclusion list and
        // runtime-node only in its default-enabled set, so a standard env override silences it.
        instrumentations: [getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-host-metrics': { enabled: true, metricGroups: ['process.cpu', 'process.memory'] },
          '@opentelemetry/instrumentation-runtime-node': { enabled: true },
        })],
        views: [...droppedInstrumentViews, dbOperationDurationView, gcDurationView],
        // The resource above already carries everything we read; the SDK's default env/process/host
        // detectors add nothing and race the first metrics/trace read against their async attributes.
        resourceDetectors: [],
      };

      if (otlp.traces.enabled) {
        logTrace('Register OpenTelemetry traces', { url: otlp.traces.exporter });
        sdkConfig.traceExporter = new OTLPTraceExporter({
          url: otlp.traces.exporter,
        });
      } else {
        // Left undefined, the SDK falls back to its own env-based default exporter and dials
        // OTLP/HTTP at localhost:4318 for a signal nobody configured.
        sdkConfig.spanProcessors = [];
      }

      const metricReaders: Array<MetricReader> = [];

      if (otlp.metrics.enabled) {
        logTrace('Register OpenTelemetry metrics', { url: otlp.metrics.exporter });
        metricReaders.push(new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: otlp.metrics.exporter,
          }),
        }));
      }

      if (prometheus.enabled) {
        logTrace('Register OpenTelemetry Prometheus snapshot reader');
        const { reader, collect } = createSnapshotReader();
        const maxReplyBytes = prometheus.max_reply_bytes;
        metricReaders.push(reader);
        collectSnapshot = collect;

        if (process.send) {
          process.on('message', onMetricsCollect(async (roundId) => {
            const text = await collectMetricsSnapshot();
            sendMetricsSnapshot(roundId, text, maxReplyBytes);
          }));
        }
      }

      // Assigned even when empty: left undefined, the SDK falls back to its own environment
      // default and pushes a periodic OTLP reader nobody configured.
      sdkConfig.metricReaders = metricReaders;

      if (otlp.logs.enabled) {
        logTrace('Register OpenTelemetry logs', { url: otlp.logs.exporter });
        sdkConfig.logRecordProcessors = [
          new BatchLogRecordProcessor({
            exporter: new OTLPLogExporter({
              url: otlp.logs.exporter,
            }),
          }),
        ];
      } else {
        // Same env-based fallback as traces: left undefined, the SDK dials its own default
        // OTLP/HTTP logs exporter at localhost:4318.
        sdkConfig.logRecordProcessors = [];
      }

      const sdk = new NodeSDK(sdkConfig);

      logTrace('Starting OpenTelemetry SDK...');
      sdk.start();
      registerTelemetryStop('OpenTelemetry SDK', async () => {
        await sdk.shutdown();
      });
      logTrace('OpenTelemetry SDK started successfully');
    } catch (error) {
      logFromError(error, 'Failed to start OpenTelemetry SDK');
    }
  }

  if (pyroscope.enabled) {
    const tags = { processName, pid };
    logTrace('Initializing Pyroscope...', { appName: serviceName, serverAddress: pyroscope.server_address, tags });

    try {
      Pyroscope.init({ serverAddress: pyroscope.server_address, appName: serviceName, tags });

      logTrace('Starting Pyroscope Heap Profiling');
      Pyroscope.startHeapProfiling();
      registerTelemetryStop('Pyroscope Heap Profiling', async () => {
        await Pyroscope.stopHeapProfiling();
      });

      if (process.platform === 'linux') {
        logTrace('Starting Pyroscope CPU Profiling (Linux detected)');
        try {
          Pyroscope.startWallProfiling();
          registerTelemetryStop('Pyroscope CPU Profiling', async () => {
            await Pyroscope.stopWallProfiling();
          });
        } catch (e) {
          logFromError(e, 'Could not start Pyroscope CPU profiling');
        }
      } else {
        logTrace('Pyroscope CPU Profiling skipped (not Linux)');
      }
    } catch (error) {
      logFromError(error, 'Failed to initialize Pyroscope');
    }
  }
};

initTelemetry();
