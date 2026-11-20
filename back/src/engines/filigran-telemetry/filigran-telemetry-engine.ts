import { AggregationTemporalityPreference, OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { ATTR_SERVICE_INSTANCE_ID } from '@opentelemetry/semantic-conventions/incubating';
import { config } from '../../config';
import { createLogger } from '../../utils/logger';
import { dbEngine } from '../db';
import { registerEngine } from '../engines-manager';
import { ensureInstanceIdentity } from '../../utils/platform-identity';
import { platformVersion } from '../../utils/platform-version';
import { drainEventCounter, EVENT_COUNTERS, incrementEventCounter } from './telemetry-events';
import { probeTelemetryEndpoint } from './telemetry-probe';
import { COUNT_GAUGES, EDITION_GAUGE, getSnapshotValue, refreshSnapshot } from './telemetry-snapshot';
import { normalizeTelemetryTags } from './telemetry-tags';

/**
 * Anonymous Filigran usage telemetry (product analytics), fully separate from
 * the operator-observability pipeline in `tracing.ts`. Mirrors the OpenCTI
 * model: OTLP/HTTP observable gauges with DELTA temporality, hardcoded
 * Filigran collector endpoints, and a startup connectivity probe that
 * self-disables telemetry when the collector is unreachable. The opt-out
 * (`telemetry.usage.enabled: false`) is checked before the probe, so an
 * opted-out instance never contacts the collector at all.
 *
 * Exported data is documented in `docs/deployment/usage-telemetry.md`:
 * aggregate cross-tenant counts only - no names, no content, no per-tenant
 * breakdowns.
 */
const TELEMETRY_ENGINE_KEY = 'filigran-telemetry';
const { logTrace, logFromError } = createLogger({ engine: TELEMETRY_ENGINE_KEY });

// Product slug is `ocrq`, like the oaev and one collectors.
const PRODUCTION_ENDPOINT = 'https://telemetry.ocrq.filigran.io/v1/metrics';
const STAGING_ENDPOINT = 'https://telemetry.ocrq.staging.filigran.io/v1/metrics';

const HOUR_MS = 60 * 60 * 1000;
// Snapshot refresh (DB counts) and export cadences. Dev exports on a 3h
// window instead of the production 6h. The dev window is deliberately NOT
// tighter than hours: the staging collector persists one object per export
// per instance, and a minutes-long dev cadence floods it when many long-lived dev/CI instances
// export at once. Refresh stays tight in dev (local DB reads only, nothing uploaded).
const PROD_REFRESH_INTERVAL_MS = HOUR_MS;
const PROD_EXPORT_INTERVAL_MS = 6 * HOUR_MS;
const DEV_REFRESH_INTERVAL_MS = 60 * 1000;
const DEV_EXPORT_INTERVAL_MS = 3 * HOUR_MS;

type Meter = ReturnType<MeterProvider['getMeter']>;

let meterProvider: MeterProvider | undefined;
let refreshTimer: NodeJS.Timeout | undefined;

// Injected by the edition feature at activation (see edition-feature.ts):
// engines never import features, so the entitlement is pushed in rather
// than read out. Absent in a process that does not activate the feature,
// which then reports CE.
let resolveIsEnterpriseEdition: (() => boolean) | undefined;

const registerGauges = (meter: Meter) => {
  const editionGauge = meter.createObservableGauge(EDITION_GAUGE.name, { description: EDITION_GAUGE.description });
  editionGauge.addCallback((result) => result.observe(resolveIsEnterpriseEdition?.() ? 1 : 0));

  for (const { name, description } of COUNT_GAUGES) {
    const gauge = meter.createObservableGauge(name, { description });
    gauge.addCallback((result) => result.observe(getSnapshotValue(name)));
  }

  // Event counters are drained at observation time: with a periodic reader,
  // callbacks run once per export, so each export reports the per-window count.
  for (const { name, description } of EVENT_COUNTERS) {
    const gauge = meter.createObservableGauge(name, { description });
    gauge.addCallback((result) => result.observe(drainEventCounter(name)));
  }
};

const startFiligranTelemetry = async () => {
  const usage = config().telemetry?.usage;
  if (usage?.enabled === false) {
    logTrace('Anonymous usage telemetry is disabled by TELEMETRY__USAGE__ENABLED=false, nothing is sent');
    return;
  }

  // Only an explicit NODE_ENV=production targets the production collector:
  // anything else (development, test, unset ad-hoc runs) goes to staging so
  // non-production data can never pollute the fleet analytics.
  const endpoint = process.env.NODE_ENV === 'production' ? PRODUCTION_ENDPOINT : STAGING_ENDPOINT;

  const reachable = await probeTelemetryEndpoint(endpoint);
  if (!reachable) {
    logTrace('Telemetry endpoint is not reachable, anonymous usage telemetry is disabled', { endpoint });
    return;
  }

  const { instanceId, instanceCreation } = await ensureInstanceIdentity(dbEngine.db);

  const attributes: Record<string, string> = {
    [ATTR_SERVICE_NAME]: 'opencrq-telemetry',
    [ATTR_SERVICE_VERSION]: platformVersion(),
    [ATTR_SERVICE_INSTANCE_ID]: instanceId,
    'service.instance.creation': instanceCreation,
  };
  const tags = normalizeTelemetryTags(usage?.tags);
  if (tags.length > 0) {
    // Shared Filigran contract: ONE comma-separated resource attribute, landed
    // as a `tags` column on every metric row by the analytics warehouse.
    attributes['filigran.telemetry.tags'] = tags.join(',');
  }

  const inDev = config().inDev;
  const exportIntervalMillis = inDev ? DEV_EXPORT_INTERVAL_MS : PROD_EXPORT_INTERVAL_MS;
  const refreshIntervalMillis = inDev ? DEV_REFRESH_INTERVAL_MS : PROD_REFRESH_INTERVAL_MS;

  meterProvider = new MeterProvider({
    resource: resourceFromAttributes(attributes),
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: endpoint,
          temporalityPreference: AggregationTemporalityPreference.DELTA,
        }),
        exportIntervalMillis,
      }),
    ],
  });
  registerGauges(meterProvider.getMeter('opencrq-telemetry'));

  const refresh = async () => {
    await refreshSnapshot(dbEngine.db, (error, gaugeName) => {
      logFromError(error, 'Telemetry count refresh failed, keeping previous value', { gauge: gaugeName });
    });
  };
  await refresh();
  refreshTimer = setInterval(refresh, refreshIntervalMillis);
  refreshTimer.unref();

  logTrace('Anonymous usage telemetry started', { endpoint, instanceId, tags, exportIntervalMillis });
};

export const filigranTelemetryEngine = registerEngine({
  key: TELEMETRY_ENGINE_KEY,
  start: () => ({
    onEnginesStarted: () => {
      // Fire-and-forget: telemetry must never break the platform boot, nor
      // delay readiness (the startup probe can wait up to 10s before
      // self-disabling in air-gapped installs).
      startFiligranTelemetry().catch((error) => {
        logFromError(error, 'Failed to start anonymous usage telemetry');
      });
    },
    stop: async () => {
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = undefined;
      }
      if (meterProvider) {
        try {
          await meterProvider.shutdown();
        } catch (error) {
          logFromError(error, 'Failed to shutdown telemetry meter provider');
        }
        meterProvider = undefined;
      }
    },
  }),
  api: {
    /**
     * Record a user session creation (login) for the next telemetry export.
     * No-op while telemetry is not running (probe failed, air-gapped install,
     * not started yet): nothing would ever drain the counter.
     */
    addUserLoginCount: () => {
      if (meterProvider) {
        incrementEventCounter('user_login_count');
      }
    },
    /** Record a risk scenario creation for the next telemetry export. */
    addRiskScenarioCreatedCount: () => {
      if (meterProvider) {
        incrementEventCounter('risk_scenario_created_count');
      }
    },
    /** Record a CRQ simulation launch for the next telemetry export. */
    addCrqSimulationLaunchedCount: () => {
      if (meterProvider) {
        incrementEventCounter('crq_simulation_launched_count');
      }
    },
    /** Record a connector sync job launch for the next telemetry export. */
    addConnectorSyncLaunchedCount: () => {
      if (meterProvider) {
        incrementEventCounter('connector_sync_launched_count');
      }
    },
  },
  registrationApi: {
    /**
     * Wire the `is_enterprise_edition` gauge to the platform's
     * entitlement. Called during feature activation; the gauge reports the
     * value at each export, so a runtime entitlement flip is picked up.
     */
    setEditionResolver: (resolver: () => boolean) => {
      resolveIsEnterpriseEdition = resolver;
    },
  },
});
