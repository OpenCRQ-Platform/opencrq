import v8 from 'node:v8';
import vm from 'node:vm';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { detectResources, hostDetector, osDetector, processDetector, resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { ATTR_DB_NAMESPACE, ATTR_DB_OPERATION_NAME, ATTR_SERVER_ADDRESS, ATTR_SERVER_PORT, METRIC_DB_CLIENT_OPERATION_DURATION } from '@opentelemetry/semantic-conventions';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// `trpc-telemetry` reaches the logger, which parses the process config at import time.
vi.mock('./logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn() }),
}));

// `--expose-gc` is not on the test runner's command line, so borrow `node:vm` to reach the global
// GC hook it would otherwise install: without a forced collection `v8js_gc_duration` only shows up
// if the runtime happens to collect on its own, which made this suite flaky.
const forceGarbageCollection = (): void => {
  v8.setFlagsFromString('--expose-gc');
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `vm.runInNewContext` returns `any`; the global it exposes under `--expose-gc` is a zero-arg function
    (vm.runInNewContext('gc') as () => void)();
  } finally {
    v8.setFlagsFromString('--no-expose-gc');
  }
};

// Asserted against real serializer output over a resource carrying the default detectors: the
// sanitisation is the exporter's, the three packages producing the runtime names float with
// auto-instrumentations-node, and the promoted label set is only observable with detectors on.
const CONTRACTED_EXPOSED_NAMES = [
  'opencrq_pm_processes',
  'opencrq_pm_collection_ok',
  'opencrq_pm_collection_duration',
  'opencrq_pm_collection_failures_total',
  'nodejs_eventloop_delay_max',
  'nodejs_eventloop_delay_mean',
  'nodejs_eventloop_delay_p99',
  'nodejs_eventloop_utilization',
  'nodejs_eventloop_time_total',
  'v8js_gc_duration',
  'v8js_memory_heap_used',
  'process_cpu_time_total',
  'process_cpu_utilization',
  'process_memory_usage',
  'db_client_connection_count',
  'db_client_connection_pending_requests',
  'db_client_connection_limit',
  'db_client_connection_wait_time',
  'db_client_connection_use_time',
  'db_client_connection_timeouts_total',
  'opencrq_db_client_connection_reconnection_attempts_total',
  'opencrq_db_table_size',
  'opencrq_db_table_rows',
  'opencrq_db_table_updates_total',
  'opencrq_db_table_vacuums_total',
  'opencrq_db_size',
  'db_client_operation_duration',
  'opencrq_trpc_server_duration',
  'opencrq_trpc_server_calls_total',
];

const CONSTANT_LABELS = ['process_name', 'service_name', 'service_version'];

const METRIC_PRODUCING_INSTRUMENTATIONS = [
  '@opentelemetry/instrumentation-host-metrics',
  '@opentelemetry/instrumentation-runtime-node',
];

const serializeContractedDocument = async () => {
  const { metrics } = await import('@opentelemetry/api');
  const { createSnapshotReader } = await import('./metrics-snapshot');
  const { droppedInstrumentViews, dbOperationDurationView, gcDurationView } = await import('./metrics-views');

  const { reader, collect } = createSnapshotReader();
  const provider = new MeterProvider({
    readers: [reader],
    views: [...droppedInstrumentViews, dbOperationDurationView, gcDurationView],
    resource: detectResources({ detectors: [hostDetector, osDetector, processDetector] })
      .merge(resourceFromAttributes({
        'service.name': 'opencrq-platform',
        'service.version': '1.2.3',
        'service.instance.id': 'worker-1234',
        'process.name': 'worker',
      })),
  });

  // Set before pm-metrics/db-metrics are imported: their meters are taken at module load, and a
  // meter taken from an unset global provider stays a no-op for the process's lifetime.
  metrics.setGlobalMeterProvider(provider);
  const { recordCollectionOutcome, registerProcessSupervisionMetrics } = await import('./pm-metrics');
  const { registerDbPoolMetrics, instrumentPoolAcquisition, recordReconnectionAttempt } = await import('../engines/db/db-metrics');
  const { registerDbTableMetrics } = await import('../engines/db/db-table-metrics');

  // Resolved through the entry point tracing.ts uses, with the same configuration.
  const instrumentations = getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-host-metrics': { enabled: true, metricGroups: ['process.cpu', 'process.memory'] },
    '@opentelemetry/instrumentation-runtime-node': { enabled: true },
  });
  const metricProducers = instrumentations.filter((instrumentation) => METRIC_PRODUCING_INSTRUMENTATIONS.includes(instrumentation.instrumentationName));
  for (const instrumentation of instrumentations) {
    if (!metricProducers.includes(instrumentation)) {
      instrumentation.disable();
    }
  }
  for (const instrumentation of metricProducers) {
    instrumentation.setMeterProvider(provider);
    instrumentation.enable();
  }

  registerProcessSupervisionMetrics(() => new Map([['worker', { status: 'RUNNING' as const }]]));
  recordCollectionOutcome('worker', 'timeout', 0.42);

  // A fake pool, shaped like `pg.Pool` for the subset `db-metrics.ts` reads, sufficient to
  // exercise every authored database instrument without a real database.
  const fakeClient = { release: () => {} };
  const fakePool = {
    totalCount: 1,
    idleCount: 0,
    waitingCount: 0,
    options: { host: 'db', port: 5432, database: 'opencrq', max: 20 },
    connect: () => Promise.resolve(fakeClient),
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test fake, partial object satisfies Pool interface in practice
  const typedFakePool = fakePool as unknown as Parameters<typeof registerDbPoolMetrics>[0];
  registerDbPoolMetrics(typedFakePool);
  instrumentPoolAcquisition(typedFakePool);
  const acquired = await typedFakePool.connect();
  acquired.release();
  recordReconnectionAttempt(typedFakePool);

  // A second fake pool whose acquisition always times out, to produce at least one sample on
  // the timeouts counter.
  const timeoutPool = {
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
    options: { host: 'db-timeout', port: 5432, database: 'opencrq', max: 20 },
    connect: () => Promise.reject(new Error('timeout exceeded when trying to connect')),
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test fake, partial object satisfies Pool interface in practice
  const typedTimeoutPool = timeoutPool as unknown as Parameters<typeof registerDbPoolMetrics>[0];
  instrumentPoolAcquisition(typedTimeoutPool);
  await typedTimeoutPool.connect().catch(() => {});

  // The reading the worker's timer would have stored, so the table families serialize without a database.
  registerDbTableMetrics(() => ({
    databaseBytes: 1_000_000,
    tables: [{ table: 'assets', heapBytes: 8192, indexesBytes: 16384, toastBytes: 0, liveRows: 10, deadRows: 2, hotUpdates: 30, updates: 40, autovacuums: 3, vacuums: 1 }],
  }));

  // `db.client.operation.duration` is adopted from `instrumentation-pg`, which requires a real
  // database connection to produce — simulate its own recording call instead, proving the name
  // and the view's remap without a live database. The name comes from the semantic-convention
  // constant the instrumentation itself uses, so an upstream rename fails here rather than
  // silently disengaging the view that bounds this histogram's attributes.
  metrics.getMeter('@opentelemetry/instrumentation-pg').createHistogram(METRIC_DB_CLIENT_OPERATION_DURATION).record(0.01, {
    [ATTR_DB_OPERATION_NAME]: 'SELECT',
    [ATTR_SERVER_ADDRESS]: 'db',
    [ATTR_SERVER_PORT]: 5432,
    [ATTR_DB_NAMESPACE]: 'opencrq',
  });

  // The call is what puts `opencrq_trpc_server_calls_total` in the document: the counter holds no
  // data point, and is therefore not serialized at all, until a call is made.
  const { instrumentTrpcCall } = await import('./trpc-telemetry');
  await instrumentTrpcCall('contract.list', 'query', () => Promise.resolve({ ok: true, data: [1, 2, 3] }), { maxResponseItems: 10 });

  try {
    forceGarbageCollection();

    // The eventloop-delay histogram discards its data below five samples, and the GC-duration
    // histogram only gains a sample once the observer callback above has run, so poll rather than
    // trust one fixed delay.
    let text = await collect();
    for (let attempt = 0; attempt < 29 && (!text.includes('nodejs_eventloop_delay_p99') || !text.includes('v8js_gc_duration')); attempt += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
      text = await collect();
    }
    return text;
  } finally {
    for (const instrumentation of metricProducers) {
      instrumentation.disable();
    }
    await provider.shutdown();
  }
};

describe('the exposed metric contract, against real serializer output', () => {
  // Serialized once: the global meter provider the supervision instruments bind to can only be
  // registered once in a process, so a second setup would record into a provider already gone.
  let document: string;
  let exposedFamilies: Set<string>;

  beforeAll(async () => {
    document = await serializeContractedDocument();
    exposedFamilies = new Set(
      document.split('\n')
        .filter((line) => line.startsWith('# TYPE '))
        .map((line) => line.slice('# TYPE '.length).split(' ')[0]),
    );
  }, 30_000);

  it('exposes exactly the contracted family set, each under its exact scraped name, carrying exactly the three identity labels', () => {
    expect(
      exposedFamilies,
      "docs/deployment/metrics.md's family list is now out of sync with the emitted metric names — update the page (and CONTRACTED_EXPOSED_NAMES above) to match",
    ).toEqual(new Set(CONTRACTED_EXPOSED_NAMES));

    const sampleLines = document.split('\n').filter((line) => line !== '' && !line.startsWith('#'));
    expect(sampleLines.length).toBeGreaterThan(0);
    for (const label of CONSTANT_LABELS) {
      expect(sampleLines.every((line) => line.includes(`${label}="`))).toBe(true);
    }

    // The anchored constant-label pattern keeps these out: `service.instance.id` changes on every
    // restart, and the rest are the default detectors' host and OS attributes.
    for (const label of ['service_instance_id', 'host_name', 'host_arch', 'os_type', 'process_owner']) {
      expect(document).not.toContain(`${label}="`);
    }
    expect(document).not.toContain('target_info');
  });
});
