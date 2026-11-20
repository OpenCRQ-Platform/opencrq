import type * as OpenTelemetryApi from '@opentelemetry/api';
import type * as OpenTelemetryCore from '@opentelemetry/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface CapturedSdkConfig {
  resource: { attributes: Record<string, unknown> },
  metricReaders?: Array<unknown>,
  views?: Array<unknown>,
}

const nodeSdkConstructor = vi.fn<(config: CapturedSdkConfig) => void>();

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: vi.fn().mockImplementation(function NodeSDK(config: CapturedSdkConfig) {
    nodeSdkConstructor(config);
    return { start: vi.fn(), shutdown: vi.fn(async () => {}) };
  }),
}));

// Vite/Vitest resolves a mocked specifier's static imports before any of this file's own
// top-level statements run, so the referenced mock must come from vi.hoisted, not a plain const.
const { diagSetLogger } = vi.hoisted(() => ({ diagSetLogger: vi.fn() }));

// Everything but diag.setLogger stays real: other modules (e.g. winston's OpenTelemetry
// transport) resolve `@opentelemetry/api` through this same mock, and only setLogger is
// exercised by this file's tests.
vi.mock('@opentelemetry/api', async (importOriginal) => {
  const actual = await importOriginal<typeof OpenTelemetryApi>();
  return { ...actual, diag: { ...actual.diag, setLogger: diagSetLogger } };
});

const { setGlobalErrorHandler } = vi.hoisted(() => ({ setGlobalErrorHandler: vi.fn() }));

// Partial for the same reason as the api mock above: `@opentelemetry/resources` is real here and
// resolves core through it.
vi.mock('@opentelemetry/core', async (importOriginal) => {
  const actual = await importOriginal<typeof OpenTelemetryCore>();
  return { ...actual, setGlobalErrorHandler };
});

const otlpMetricExporterConstructor = vi.fn();

vi.mock('@opentelemetry/exporter-metrics-otlp-grpc', () => ({
  OTLPMetricExporter: vi.fn().mockImplementation(function OTLPMetricExporter(config: unknown) {
    otlpMetricExporterConstructor(config);
    return { name: 'fake-otlp-exporter' };
  }),
}));

const periodicExportingMetricReaderConstructor = vi.fn();

vi.mock('@opentelemetry/sdk-metrics', () => ({
  PeriodicExportingMetricReader: vi.fn().mockImplementation(function PeriodicExportingMetricReader(config: unknown) {
    periodicExportingMetricReaderConstructor(config);
    return { name: 'fake-periodic-reader' };
  }),
}));

const logError = vi.fn();
const logFromError = vi.fn();

vi.mock('./utils/logger', () => ({
  createLogger: vi.fn(() => ({ logTrace: vi.fn(), logError, logFromError })),
}));

const getNodeAutoInstrumentations = vi.fn(() => []);

vi.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations,
}));

vi.mock('@opentelemetry/exporter-trace-otlp-grpc', () => ({
  OTLPTraceExporter: vi.fn(),
}));

vi.mock('@pyroscope/nodejs', () => ({
  default: {
    init: vi.fn(),
    startHeapProfiling: vi.fn(),
    stopHeapProfiling: vi.fn(async () => {}),
    startWallProfiling: vi.fn(),
    stopWallProfiling: vi.fn(async () => {}),
  },
}));

const getProcessName = vi.fn(() => 'test-process');

type Transport = { enabled: boolean, exporter?: string };
type PrometheusTransport = { enabled: boolean, max_reply_bytes?: number };

const OFF = { enabled: false };

const observabilityWith = ({ traces = OFF, metrics = OFF, prometheus = OFF }: {
  traces?: Transport,
  metrics?: Transport,
  prometheus?: PrometheusTransport,
}) => ({
  service_name: 'opencrq-test',
  otlp: { traces, metrics, logs: OFF },
  prometheus,
  pyroscope: OFF,
});

const DEFAULT_OBSERVABILITY = observabilityWith({ traces: { enabled: true, exporter: 'http://localhost:4317' } });

let observabilityOverride: typeof DEFAULT_OBSERVABILITY | undefined;

vi.mock('./config', () => ({
  getProcessName,
  pmConfig: {
    get telemetry() {
      return { observability: observabilityOverride ?? DEFAULT_OBSERVABILITY };
    },
  },
}));

const fakeDroppedInstrumentViews = [{ instrumentName: 'http.server.*' }];
const fakeDbOperationDurationView = { instrumentName: 'db.client.operation.duration' };
const fakeGcDurationView = { instrumentName: 'v8js.gc.duration' };

vi.mock('./utils/metrics-views', () => ({
  droppedInstrumentViews: fakeDroppedInstrumentViews,
  dbOperationDurationView: fakeDbOperationDurationView,
  gcDurationView: fakeGcDurationView,
  DB_HISTOGRAM_BUCKET_BOUNDARIES: [0, 1],
}));

const createSnapshotReader = vi.fn();

vi.mock('./utils/metrics-snapshot', () => ({
  createSnapshotReader,
}));

const onMetricsCollect = vi.fn((collect: (roundId: string) => Promise<void>) => collect);
const sendMetricsSnapshot = vi.fn();

vi.mock('./utils/metrics-ipc', () => ({
  onMetricsCollect,
  sendMetricsSnapshot,
}));

describe('tracing resource identity', () => {
  const originalAppVersion = process.env.APP_VERSION;

  beforeEach(() => {
    vi.resetModules();
    nodeSdkConstructor.mockClear();
    getProcessName.mockClear();
    getNodeAutoInstrumentations.mockClear();
    observabilityOverride = undefined;
  });

  afterEach(() => {
    if (originalAppVersion === undefined) {
      delete process.env.APP_VERSION;
    } else {
      process.env.APP_VERSION = originalAppVersion;
    }
  });

  it('stamps process.name and service.version, and leaves service.instance.id untouched', async () => {
    process.env.APP_VERSION = '1.2.3';

    await import('./tracing');

    expect(nodeSdkConstructor).toHaveBeenCalledTimes(1);
    const [config] = nodeSdkConstructor.mock.calls[0];
    const { attributes } = config.resource;

    expect(attributes['process.name']).toBe('test-process');
    expect(attributes['service.version']).toBe('1.2.3');
    expect(attributes['service.name']).toBe('opencrq-test');
    expect(attributes['service.instance.id']).toBe(`test-process-${process.pid}`);
  });

  it('falls back service.version to "0.0.0-dev" when APP_VERSION is unset', async () => {
    delete process.env.APP_VERSION;

    await import('./tracing');

    expect(nodeSdkConstructor).toHaveBeenCalledTimes(1);
    const [config] = nodeSdkConstructor.mock.calls[0];
    const { attributes } = config.resource;

    expect(attributes['service.version']).toBe('0.0.0-dev');
    expect(attributes['process.name']).toBe('test-process');
    expect(attributes['service.name']).toBe('opencrq-test');
    expect(attributes['service.instance.id']).toBe(`test-process-${process.pid}`);
  });

  it('falls back service.version to "0.0.0-dev" when APP_VERSION is an empty string', async () => {
    process.env.APP_VERSION = '';

    await import('./tracing');

    expect(nodeSdkConstructor).toHaveBeenCalledTimes(1);
    const [config] = nodeSdkConstructor.mock.calls[0];
    const { attributes } = config.resource;

    expect(attributes['service.version']).toBe('0.0.0-dev');
    expect(attributes['process.name']).toBe('test-process');
    expect(attributes['service.name']).toBe('opencrq-test');
    expect(attributes['service.instance.id']).toBe(`test-process-${process.pid}`);
  });

  it('pins host-metrics and runtime-node explicitly, scopes host-metrics to process.cpu/process.memory, and adds no other instrumentation config', async () => {
    await import('./tracing');

    expect(getNodeAutoInstrumentations).toHaveBeenCalledTimes(1);
    expect(getNodeAutoInstrumentations).toHaveBeenCalledWith({
      '@opentelemetry/instrumentation-host-metrics': { enabled: true, metricGroups: ['process.cpu', 'process.memory'] },
      '@opentelemetry/instrumentation-runtime-node': { enabled: true },
    });
  });

  it('falls back service.version to "0.0.0-dev" when APP_VERSION is whitespace-only', async () => {
    process.env.APP_VERSION = '  ';

    await import('./tracing');

    expect(nodeSdkConstructor).toHaveBeenCalledTimes(1);
    const [config] = nodeSdkConstructor.mock.calls[0];
    expect(config.resource.attributes['service.version']).toBe('0.0.0-dev');
  });
});

describe('tracing metrics.prometheus wiring', () => {
  const originalSend = process.send;

  beforeEach(() => {
    vi.resetModules();
    nodeSdkConstructor.mockClear();
    createSnapshotReader.mockReset();
    onMetricsCollect.mockClear();
    sendMetricsSnapshot.mockClear();
    observabilityOverride = observabilityWith({ prometheus: { enabled: true, max_reply_bytes: 2 * 1024 * 1024 } });
  });

  afterEach(() => {
    process.send = originalSend;
  });

  it('builds the resource, wires the snapshot reader and the drop views, when only metrics.prometheus is enabled', async () => {
    const fakeReader = { name: 'fake-reader' };
    createSnapshotReader.mockReturnValue({ reader: fakeReader, collect: vi.fn() });

    await import('./tracing');

    expect(nodeSdkConstructor).toHaveBeenCalledTimes(1);
    const [config] = nodeSdkConstructor.mock.calls[0];
    expect(config.metricReaders).toEqual([fakeReader]);
    expect(config.views).toEqual([...fakeDroppedInstrumentViews, fakeDbOperationDurationView, fakeGcDurationView]);
  });

  it('does not register a child-side collect listener when process.send is undefined', async () => {
    process.send = undefined;
    createSnapshotReader.mockReturnValue({ reader: {}, collect: vi.fn() });

    await import('./tracing');

    expect(onMetricsCollect).not.toHaveBeenCalled();
  });

  it('registers the child-side collect listener and replies through sendMetricsSnapshot', async () => {
    process.send = vi.fn();
    const collect = vi.fn().mockResolvedValue('# metrics text');
    createSnapshotReader.mockReturnValue({ reader: {}, collect });

    await import('./tracing');
    const { collectMetricsSnapshot } = await import('./tracing');

    expect(onMetricsCollect).toHaveBeenCalledTimes(1);
    const registeredCallback = onMetricsCollect.mock.calls[0][0];

    await registeredCallback('round-1');

    expect(collect).toHaveBeenCalledTimes(1);
    expect(sendMetricsSnapshot).toHaveBeenCalledWith('round-1', '# metrics text', 2 * 1024 * 1024);
    await expect(collectMetricsSnapshot()).resolves.toBe('# metrics text');
  });

  it('collectMetricsSnapshot resolves to an empty string when no snapshot reader was built', async () => {
    observabilityOverride = observabilityWith({});

    const { collectMetricsSnapshot } = await import('./tracing');

    expect(createSnapshotReader).not.toHaveBeenCalled();
    await expect(collectMetricsSnapshot()).resolves.toBe('');
  });
});

describe('tracing metrics.otlp wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    nodeSdkConstructor.mockClear();
    createSnapshotReader.mockReset();
    onMetricsCollect.mockClear();
    otlpMetricExporterConstructor.mockClear();
    periodicExportingMetricReaderConstructor.mockClear();
    observabilityOverride = observabilityWith({ metrics: { enabled: true, exporter: 'http://otel-collector:4317' } });
  });

  it('constructs the OTLP exporter and periodic reader, and wires no scrape-side machinery, when only metrics.otlp is enabled', async () => {
    await import('./tracing');

    expect(otlpMetricExporterConstructor).toHaveBeenCalledWith({ url: 'http://otel-collector:4317' });
    expect(periodicExportingMetricReaderConstructor).toHaveBeenCalledTimes(1);

    const [config] = nodeSdkConstructor.mock.calls[0];
    expect(config.metricReaders).toHaveLength(1);
    expect(createSnapshotReader).not.toHaveBeenCalled();
    expect(onMetricsCollect).not.toHaveBeenCalled();
  });

  it('registers both metric readers, concurrently, when metrics.otlp and metrics.prometheus are both enabled', async () => {
    const fakeReader = { name: 'fake-prometheus-reader' };
    createSnapshotReader.mockReturnValue({ reader: fakeReader, collect: vi.fn() });
    observabilityOverride = observabilityWith({ metrics: { enabled: true, exporter: 'http://otel-collector:4317' }, prometheus: { enabled: true, max_reply_bytes: 2 * 1024 * 1024 } });

    await import('./tracing');

    const [config] = nodeSdkConstructor.mock.calls[0];
    expect(config.metricReaders).toHaveLength(2);
    expect(otlpMetricExporterConstructor).toHaveBeenCalledTimes(1);
    expect(createSnapshotReader).toHaveBeenCalledTimes(1);
  });
});

describe('tracing OpenTelemetry diagnostics routing', () => {
  beforeEach(() => {
    vi.resetModules();
    diagSetLogger.mockClear();
    setGlobalErrorHandler.mockClear();
    logError.mockClear();
    logFromError.mockClear();
    observabilityOverride = observabilityWith({ metrics: { enabled: true, exporter: 'http://otel-collector:4317' } });
  });

  it('registers a DiagLogger at ERROR level that forwards a first error and de-duplicates the next identical one', async () => {
    const { DiagLogLevel } = await import('@opentelemetry/api');
    await import('./tracing');

    expect(diagSetLogger).toHaveBeenCalledTimes(1);
    const [registeredLogger, level] = diagSetLogger.mock.calls[0];
    expect(level).toBe(DiagLogLevel.ERROR);

    registeredLogger.error('collector unreachable');
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith('collector unreachable', undefined);

    registeredLogger.error('collector unreachable');
    expect(logError).toHaveBeenCalledTimes(1);

    registeredLogger.error('a different failure');
    expect(logError).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenLastCalledWith('a different failure', undefined);
  });

  it('forwards the underlying Error via logFromError instead of logError when the SDK passes one', async () => {
    await import('./tracing');
    const [registeredLogger] = diagSetLogger.mock.calls[0];

    registeredLogger.error('PeriodicExportingMetricReader: metrics export threw error', new Error('ECONNREFUSED'));

    expect(logFromError).toHaveBeenCalledTimes(1);
    expect(logFromError).toHaveBeenCalledWith(expect.any(Error), 'PeriodicExportingMetricReader: metrics export threw error', undefined);
    expect(logError).not.toHaveBeenCalled();
  });

  it('does not de-duplicate two distinct underlying errors that share the same template message', async () => {
    await import('./tracing');
    const [registeredLogger] = diagSetLogger.mock.calls[0];

    registeredLogger.error('PeriodicExportingMetricReader: metrics export threw error', new Error('ECONNREFUSED'));
    registeredLogger.error('PeriodicExportingMetricReader: metrics export threw error', new Error('ENOTFOUND'));

    expect(logFromError).toHaveBeenCalledTimes(2);
  });

  it('de-duplicates two separate Error instances carrying the same message, as a sustained outage would produce', async () => {
    await import('./tracing');
    const [registeredLogger] = diagSetLogger.mock.calls[0];

    registeredLogger.error('PeriodicExportingMetricReader: metrics export threw error', new Error('ECONNREFUSED'));
    registeredLogger.error('PeriodicExportingMetricReader: metrics export threw error', new Error('ECONNREFUSED'));

    expect(logFromError).toHaveBeenCalledTimes(1);
  });

  it('keeps de-duplicating each failure independently when two exporters fail concurrently and alternate', async () => {
    await import('./tracing');
    const [registeredLogger] = diagSetLogger.mock.calls[0];

    for (let tick = 0; tick < 5; tick += 1) {
      registeredLogger.error('metrics export threw error', new Error('ECONNREFUSED'));
      registeredLogger.error('logs export threw error', new Error('ECONNREFUSED'));
    }

    expect(logFromError).toHaveBeenCalledTimes(2);
  });

  // core stringifies an exception into JSON before it reaches a DiagLogger, so a stack frame
  // arrives escaped, as the two characters \ and n.
  const ESCAPED_NEWLINE = '\\n';
  const stringifiedFailure = (frame: string) => `{"stack":"Error: export failed${ESCAPED_NEWLINE}    at ${frame}","message":"export failed","name":"Error"}`;

  it('keeps two diagnostics apart when their messages differ on a line reading as a frame', async () => {
    await import('./tracing');
    const [registeredLogger] = diagSetLogger.mock.calls[0];

    registeredLogger.error('export failed', new Error(['no connection', '    at collector-a'].join('\n')));
    registeredLogger.error('export failed', new Error(['no connection', '    at collector-b'].join('\n')));

    expect(logFromError).toHaveBeenCalledTimes(2);
  });

  it('de-duplicates a stringified exception whose stack frames differ between ticks, the shape core actually sends', async () => {
    await import('./tracing');
    const [registeredLogger] = diagSetLogger.mock.calls[0];

    registeredLogger.error(stringifiedFailure('process.processTicksAndRejections (node:internal/process/task_queues:104:5)'));
    registeredLogger.error(stringifiedFailure('runNextTicks (node:internal/process/task_queues:69:3)'));

    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('keeps two stringified exceptions apart when they differ only past the stack', async () => {
    await import('./tracing');
    const [registeredLogger] = diagSetLogger.mock.calls[0];

    registeredLogger.error(`{"stack":"Error: export failed${ESCAPED_NEWLINE}    at foo","code":"14"}`);
    registeredLogger.error(`{"stack":"Error: export failed${ESCAPED_NEWLINE}    at bar","code":"4"}`);

    expect(logError).toHaveBeenCalledTimes(2);
  });

  it('takes the global error handler, before the instrumentations are constructed, and forwards the exception itself', async () => {
    await import('./tracing');

    expect(setGlobalErrorHandler).toHaveBeenCalledTimes(1);
    expect(setGlobalErrorHandler.mock.invocationCallOrder[0]).toBeLessThan(getNodeAutoInstrumentations.mock.invocationCallOrder[0]);

    const [registeredHandler] = setGlobalErrorHandler.mock.calls[0];
    const failure = new Error('14 UNAVAILABLE: No connection established');
    registeredHandler(failure);

    expect(logFromError).toHaveBeenCalledTimes(1);
    expect(logFromError).toHaveBeenCalledWith(failure, 'OpenTelemetry SDK failure', undefined);
    expect(logError).not.toHaveBeenCalled();
  });

  it('de-duplicates a sustained outage reaching the global error handler with a fresh stack on each tick', async () => {
    await import('./tracing');
    const [registeredHandler] = setGlobalErrorHandler.mock.calls[0];

    for (let tick = 0; tick < 5; tick += 1) {
      const failure = new Error('14 UNAVAILABLE: No connection established');
      failure.stack = ['Error: 14 UNAVAILABLE: No connection established', `    at tick${tick} (node:internal/process/task_queues:104:5)`].join('\n');
      registeredHandler(failure);
    }

    expect(logFromError).toHaveBeenCalledTimes(1);
  });

  it('keeps two failures apart at the global error handler when their messages differ on a line reading as a frame', async () => {
    await import('./tracing');
    const [registeredHandler] = setGlobalErrorHandler.mock.calls[0];

    registeredHandler(new Error(['export failed', '    at collector-a'].join('\n')));
    registeredHandler(new Error(['export failed', '    at collector-b'].join('\n')));

    expect(logFromError).toHaveBeenCalledTimes(2);
  });

  it('keeps two failures apart at the global error handler when only their code differs', async () => {
    await import('./tracing');
    const [registeredHandler] = setGlobalErrorHandler.mock.calls[0];

    registeredHandler(Object.assign(new Error('export failed'), { code: '14' }));
    registeredHandler(Object.assign(new Error('export failed'), { code: '4' }));

    expect(logFromError).toHaveBeenCalledTimes(2);
  });

  it('logs a non-Error exception through logError', async () => {
    await import('./tracing');
    const [registeredHandler] = setGlobalErrorHandler.mock.calls[0];

    registeredHandler('collector unreachable');
    registeredHandler('collector unreachable');

    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith('collector unreachable', undefined);
    expect(logFromError).not.toHaveBeenCalled();
  });

  it('describes a non-Error exception from its contract fields, without walking the value', async () => {
    await import('./tracing');
    const [registeredHandler] = setGlobalErrorHandler.mock.calls[0];

    const circular: Record<string, unknown> = { name: 'ExportFailure', code: '14', message: 'no connection established' };
    circular.self = circular;

    expect(() => registeredHandler(circular)).not.toThrow();
    expect(logError).toHaveBeenCalledWith('ExportFailure 14 no connection established', undefined);
  });

  it('still reports a failure whose own logging throws, which core would swallow along with it', async () => {
    await import('./tracing');
    const [registeredHandler] = setGlobalErrorHandler.mock.calls[0];
    logFromError.mockImplementationOnce(() => {
      throw new RangeError('Maximum call stack size exceeded'); 
    });

    const failure = new Error('14 UNAVAILABLE: No connection established');
    failure.cause = failure;

    expect(() => registeredHandler(failure)).not.toThrow();
    expect(logError).toHaveBeenCalledWith('Error 14 UNAVAILABLE: No connection established', undefined);
  });

  it('drops an expired window whatever its count, so the map holds only the failures of the last window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      await import('./tracing');
      const [registeredHandler] = setGlobalErrorHandler.mock.calls[0];

      registeredHandler(new Error('transient failure'));
      vi.setSystemTime(new Date('2026-01-01T00:01:00.000Z'));
      registeredHandler(new Error('transient failure'));

      vi.setSystemTime(new Date('2026-01-01T00:06:00.000Z'));
      registeredHandler(new Error('an unrelated failure'));

      vi.setSystemTime(new Date('2026-01-01T00:07:00.000Z'));
      registeredHandler(new Error('transient failure'));

      expect(logFromError).toHaveBeenCalledTimes(3);
      expect(logFromError).toHaveBeenLastCalledWith(expect.any(Error), 'OpenTelemetry SDK failure', undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries the suppressed occurrence count onto the line that reopens the window, and starts the next window clean', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      await import('./tracing');
      const [registeredHandler] = setGlobalErrorHandler.mock.calls[0];
      const outage = () => new Error('14 UNAVAILABLE: No connection established');

      registeredHandler(outage());
      expect(logFromError).toHaveBeenCalledTimes(1);
      expect(logFromError).toHaveBeenLastCalledWith(expect.any(Error), 'OpenTelemetry SDK failure', undefined);

      for (let minute = 1; minute <= 4; minute += 1) {
        vi.setSystemTime(new Date(`2026-01-01T00:0${minute}:00.000Z`));
        registeredHandler(outage());
      }
      expect(logFromError).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date('2026-01-01T00:05:00.000Z'));
      registeredHandler(outage());
      expect(logFromError).toHaveBeenCalledTimes(2);
      expect(logFromError).toHaveBeenLastCalledWith(expect.any(Error), 'OpenTelemetry SDK failure', {
        suppressed: 4,
        suppressedSince: '2026-01-01T00:00:00.000Z',
      });

      vi.setSystemTime(new Date('2026-01-01T00:10:00.000Z'));
      registeredHandler(outage());
      expect(logFromError).toHaveBeenCalledTimes(3);
      expect(logFromError).toHaveBeenLastCalledWith(expect.any(Error), 'OpenTelemetry SDK failure', undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it('installs the diagnostics logger before the instrumentations are constructed, so a failing one is not reported into a no-op', async () => {
    await import('./tracing');

    expect(diagSetLogger).toHaveBeenCalledTimes(1);
    expect(diagSetLogger.mock.invocationCallOrder[0]).toBeLessThan(getNodeAutoInstrumentations.mock.invocationCallOrder[0]);
  });
});

describe('tracing with every metrics transport off', () => {
  beforeEach(() => {
    vi.resetModules();
    nodeSdkConstructor.mockClear();
    createSnapshotReader.mockReset();
    onMetricsCollect.mockClear();
    otlpMetricExporterConstructor.mockClear();
    periodicExportingMetricReaderConstructor.mockClear();
    observabilityOverride = observabilityWith({ traces: { enabled: true, exporter: 'http://otel-collector:4317' } });
  });

  it('passes an empty reader array rather than none, so the SDK cannot fall back to its own environment default', async () => {
    await import('./tracing');

    const [config] = nodeSdkConstructor.mock.calls[0];
    expect(config.metricReaders).toEqual([]);
    expect(createSnapshotReader).not.toHaveBeenCalled();
    expect(otlpMetricExporterConstructor).not.toHaveBeenCalled();
    expect(periodicExportingMetricReaderConstructor).not.toHaveBeenCalled();
    expect(onMetricsCollect).not.toHaveBeenCalled();
  });
});
