import type { ConnectorSource, IntegrationSource, JobBackedConnectorEntry, JobScheduleRow, Schedule } from '@app/module';
import { CONNECTOR_INVENTORY, DEFAULT_THREATS_DATASET_FILE, INTEGRATION_SOURCES, nextOccurrence } from '@app/module';

export interface ConnectorConfiguration {
  platformConfigured: boolean,
  tenantConfigured: boolean,
  /** The tenant's own switch: false only for a connector a tenant turned off. */
  enabled: boolean,
  url: string | null,
}

/** What a tenant's Default Threats settings say about whether the connector runs and whether it still has to load. */
export interface DefaultThreatsRunState {
  enabled: boolean,
  loaded: boolean,
}

export const defaultThreatsRunState = (settings: { enabled: boolean, loadedAt: Date | null }): DefaultThreatsRunState => ({
  enabled: settings.enabled,
  loaded: settings.loadedAt !== null,
});

/** The per-tenant credential blocks, as `config().connectors` supplies them (keyed by tenant id). */
export interface ConnectorsCredentials {
  microsoft_graph?: Record<string, unknown>,
  openaev?: Record<string, { url: string }>,
  opencti?: Record<string, { url: string }>,
  drata?: Record<string, unknown>,
  default_threats?: { dataset_url?: string },
}

/** OpenCRQ's own dataset repository. A platform empties it to turn the connector off, or points it to a mirror. */
export const DEFAULT_THREATS_DATASET_URL = 'https://raw.githubusercontent.com/OpenCRQ-Platform/datasets/main/data/';

/** The file this release reads, or null when the platform turned the connector off. */
export const defaultThreatsFileUrl = (credentials: ConnectorsCredentials | undefined): string | null => {
  const base = credentials?.default_threats?.dataset_url ?? DEFAULT_THREATS_DATASET_URL;
  if (base.trim() === '') {
    return null;
  }
  return new URL(DEFAULT_THREATS_DATASET_FILE, base.endsWith('/') ? base : `${base}/`).toString();
};

export interface ConnectorSettingsRow {
  source: IntegrationSource,
  serviceAccountId: string | null,
}

export interface OpenctiConnectorSettingsRow {
  streamId: string | null,
  serviceAccountId: string | null,
}

/**
 * Whether each connector is usable at all, bound for this tenant, switched on, and where its vendor lives.
 *
 * FIRST, NIST and CISA read public sources, so they carry no deployment credential and are always
 * available. OpenCTI is bound through its own settings row rather than `integration_settings`.
 * Default Threats reads a public file too and needs no service account, so a tenant has nothing to
 * configure: whether it runs is its switch, carried as `enabled`. `defaultThreats` is null when there
 * is no tenant to read it for.
 *
 * Shared by the connectors list and by the older per-connector status endpoint, so the two cannot
 * disagree the day a connector is added.
 */
export const resolveConnectorConfigurations = (
  credentials: ConnectorsCredentials | undefined,
  tenantId: string | undefined,
  settings: ReadonlyArray<ConnectorSettingsRow>,
  openctiSettings: OpenctiConnectorSettingsRow | null,
  defaultThreats: DefaultThreatsRunState | null,
): Record<ConnectorSource, ConnectorConfiguration> => {
  const defaultThreatsUrl = defaultThreatsFileUrl(credentials);
  const bound = new Set(settings.filter((row) => row.serviceAccountId != null).map((row) => row.source));
  const microsoftGraphConfig = tenantId ? credentials?.microsoft_graph?.[tenantId] : undefined;
  const openaevConfig = tenantId ? credentials?.openaev?.[tenantId] : undefined;
  const drataConfig = tenantId ? credentials?.drata?.[tenantId] : undefined;
  const openctiConfig = tenantId ? credentials?.opencti?.[tenantId] : undefined;
  return {
    first: { platformConfigured: true, tenantConfigured: bound.has('first'), enabled: true, url: 'https://www.first.org/epss/' },
    nist: { platformConfigured: true, tenantConfigured: bound.has('nist'), enabled: true, url: 'https://nvd.nist.gov/' },
    cisa: {
      platformConfigured: true,
      tenantConfigured: bound.has('cisa'),
      enabled: true,
      url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
    },
    microsoft_graph: {
      platformConfigured: !!microsoftGraphConfig,
      tenantConfigured: bound.has('microsoft_graph'),
      enabled: true,
      url: 'https://security.microsoft.com/',
    },
    openaev: {
      platformConfigured: !!openaevConfig,
      tenantConfigured: bound.has('openaev'),
      enabled: true,
      url: openaevConfig?.url ?? null,
    },
    drata: {
      platformConfigured: !!drataConfig,
      tenantConfigured: bound.has('drata'),
      enabled: true,
      url: 'https://app.drata.com/',
    },
    opencti: {
      platformConfigured: !!openctiConfig,
      tenantConfigured: !!(openctiSettings?.streamId && openctiSettings.serviceAccountId),
      enabled: true,
      url: openctiConfig?.url ?? null,
    },
    default_threats: {
      platformConfigured: defaultThreatsUrl !== null,
      tenantConfigured: true,
      enabled: defaultThreats?.enabled ?? true,
      url: defaultThreatsUrl,
    },
  };
};

export interface RunnableConnector {
  entry: JobBackedConnectorEntry,
  /**
   * What a run is enqueued with, null when the connector cannot run: no deployment credentials, no
   * service account bound, or switched off.
   */
  payload: Record<string, unknown> | null,
  /** Runs as soon as its schedule is set up, rather than at the default's next slot. */
  firstRunNow: boolean,
}

/** Every job-backed connector with the payload a run is enqueued with, under the rule Sync now applies. */
export const resolveRunnableConnectors = (
  credentials: ConnectorsCredentials | undefined,
  tenantId: string,
  settings: ReadonlyArray<ConnectorSettingsRow>,
  defaultThreats: DefaultThreatsRunState,
): Array<RunnableConnector> => {
  const configurations = resolveConnectorConfigurations(credentials, tenantId, settings, null, defaultThreats);
  const integrations = INTEGRATION_SOURCES.map((source) => {
    const { platformConfigured, tenantConfigured } = configurations[source];
    const serviceAccountId = settings.find((row) => row.source === source)?.serviceAccountId ?? null;
    return {
      entry: CONNECTOR_INVENTORY[source],
      payload: platformConfigured && tenantConfigured && serviceAccountId !== null ? { serviceAccountId } : null,
      firstRunNow: false,
    };
  });
  const runnable = configurations.default_threats.platformConfigured && configurations.default_threats.enabled;
  // A tenant that has never loaded the dataset has no threat to run a scenario on until it does.
  return [...integrations, {
    entry: CONNECTOR_INVENTORY.default_threats,
    payload: runnable ? {} : null,
    firstRunNow: runnable && !defaultThreats.loaded,
  }];
};

export interface ConnectorScheduleRead {
  schedule: Schedule,
  /** Null when nothing will run: a manual schedule, or a connector that cannot run. */
  nextRunAt: Date | null,
}

/** A connector with no schedule saved runs on its inventory default, so its next run is the default's next slot. */
export const readConnectorSchedule = (
  entry: JobBackedConnectorEntry,
  saved: JobScheduleRow | null,
  runnable: boolean,
  nowMs: number,
): ConnectorScheduleRead => {
  const { cadence, atMinute, weekday, timeZone } = saved ?? entry.defaultSchedule;
  const schedule = { cadence, atMinute, weekday, timeZone };
  const nextRunAt = saved === null ? nextOccurrence(schedule, nowMs) : saved.nextRunAt;
  return { schedule, nextRunAt: runnable ? nextRunAt : null };
};
