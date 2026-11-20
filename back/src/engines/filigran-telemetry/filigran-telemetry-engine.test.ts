import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Engine } from '../engines-manager';

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  probeTelemetryEndpoint: vi.fn(),
  resourceFromAttributes: vi.fn((attributes: Record<string, string>) => attributes),
  registered: [] as Array<Engine>,
}));

vi.mock('../../config', () => ({ config: mocks.config }));
vi.mock('../../utils/logger', () => ({ createLogger: () => ({ logTrace: vi.fn(), logFromError: vi.fn() }) }));
vi.mock('./telemetry-probe', () => ({ probeTelemetryEndpoint: mocks.probeTelemetryEndpoint }));
vi.mock('../db', () => ({ dbEngine: {} }));
vi.mock('../../utils/platform-identity', () => ({
  ensureInstanceIdentity: () => Promise.resolve({ instanceId: 'instance-id', instanceCreation: '2026-01-01T00:00:00.000Z' }),
}));
// Stubbed whole: the real module reads its gauges from the `@app/module` barrel, which loads every
// domain module, a cold import slow enough to time a test out under load.
vi.mock('./telemetry-snapshot', () => ({
  EDITION_GAUGE: { name: 'is_enterprise_edition', description: '' },
  COUNT_GAUGES: [],
  getSnapshotValue: () => 0,
  refreshSnapshot: async () => {},
}));
vi.mock('@opentelemetry/resources', () => ({ resourceFromAttributes: mocks.resourceFromAttributes }));
vi.mock('@opentelemetry/exporter-metrics-otlp-http', () => ({
  AggregationTemporalityPreference: { DELTA: 'DELTA' },
  OTLPMetricExporter: class {},
}));
vi.mock('@opentelemetry/sdk-metrics', () => ({
  PeriodicExportingMetricReader: class {},
  MeterProvider: class {
    getMeter() {
      return { createObservableGauge: () => ({ addCallback: () => {} }) };
    }

    async shutdown() {}
  },
}));
vi.mock('../engines-manager', () => ({
  registerEngine: (engine: Engine & { api?: object }) => {
    mocks.registered.push(engine);
    return engine.api;
  },
}));

const startEngine = async () => {
  vi.resetModules();
  mocks.registered.length = 0;
  await import('./filigran-telemetry-engine');
  const [engine] = mocks.registered;
  const handler = await engine.start(new AbortController().signal);
  handler.onEnginesStarted?.();
  return handler;
};

describe('filigranTelemetryEngine', () => {
  beforeEach(() => {
    mocks.config.mockReset();
    mocks.probeTelemetryEndpoint.mockReset().mockResolvedValue(false);
    mocks.resourceFromAttributes.mockClear();
  });

  it('never contacts the collector when telemetry.usage.enabled is false', async () => {
    mocks.config.mockReturnValue({ telemetry: { usage: { enabled: false, tags: '' } } });

    await startEngine();
    await new Promise((resolve) => setImmediate(resolve));

    expect(mocks.probeTelemetryEndpoint).not.toHaveBeenCalled();
  });

  it.each([
    ['telemetry.usage.enabled is true', { telemetry: { usage: { enabled: true, tags: '' } } }],
    ['the telemetry block is absent', {}],
  ])('probes the collector when %s', async (_case, parsedConfig) => {
    mocks.config.mockReturnValue(parsedConfig);

    await startEngine();

    await vi.waitFor(() => expect(mocks.probeTelemetryEndpoint).toHaveBeenCalledOnce());
  });

  it('exports the normalized telemetry.usage.tags as the filigran.telemetry.tags resource attribute', async () => {
    mocks.config.mockReturnValue({ inDev: false, telemetry: { usage: { enabled: true, tags: 'SaaS, eu-west,saas' } } });
    mocks.probeTelemetryEndpoint.mockResolvedValue(true);

    const handler = await startEngine();
    await vi.waitFor(() => expect(mocks.resourceFromAttributes).toHaveBeenCalledOnce());
    await handler.stop?.();

    expect(mocks.resourceFromAttributes.mock.calls[0]?.[0]).toMatchObject({ 'filigran.telemetry.tags': 'eu-west,saas' });
  });
});
