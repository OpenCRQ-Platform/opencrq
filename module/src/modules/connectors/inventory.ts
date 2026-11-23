import type { Schedule } from '../job-schedules/cadence';

export const CONNECTOR_SOURCES = [
  'first',
  'nist',
  'cisa',
  'microsoft_graph',
  'openaev',
  'drata',
  'opencti',
  'default_threats',
] as const;
export type ConnectorSource = (typeof CONNECTOR_SOURCES)[number];

/** The feeds that enrich the CVEs a tenant holds, and never bring one into its scope. */
export const CVE_FEED_SOURCES = ['nist', 'first', 'cisa'] as const satisfies ReadonlyArray<ConnectorSource>;

export const CONNECTOR_DOMAINS = ['vulnerability', 'simulation', 'compliance', 'threat_intelligence'] as const;
export type ConnectorDomain = (typeof CONNECTOR_DOMAINS)[number];

export const CONNECTOR_MECHANISMS = ['scheduled_pull', 'live_stream'] as const;
export type ConnectorMechanism = (typeof CONNECTOR_MECHANISMS)[number];

/**
 * The entity kinds a connector writes. A closed union rather than free text: the same codes define
 * which tables a record count spans, and a facet cannot be built over strings nobody enumerates.
 */
export const CONNECTOR_SCOPE_KINDS = [
  'cves',
  'supporting_assets',
  'findings',
  'capability_assessments',
  'threat_intelligence',
] as const;
export type ConnectorScopeKind = (typeof CONNECTOR_SCOPE_KINDS)[number];

interface ConnectorInventoryIdentity {
  source: ConnectorSource,
  domain: ConnectorDomain,
  mechanism: ConnectorMechanism,
  loggerFeature: string,
  scopeKinds: ReadonlyArray<ConnectorScopeKind>,
}

export type RunUnit = 'assets' | 'cves' | 'observations' | 'frameworks' | 'threats';

/** A connector whose work is one job on the queue, with everything an enqueue needs. */
export interface JobBackedConnectorEntry extends ConnectorInventoryIdentity {
  jobKind: string,
  idempotencyPrefix: string,
  maxRuntimeMs: number,
  maxAttempts: number,
  runUnit: RunUnit,
  /** What a configured connector runs on until somebody saves a schedule of its own. */
  defaultSchedule: Schedule,
  /** No cadence tighter than this is offered: a rate-limited source, or a run lasting minutes. */
  minIntervalHours: number,
}

/** The stream consumer runs continuously, so it has no job and none of a job's options. */
export interface StreamConnectorEntry extends ConnectorInventoryIdentity {
  jobKind: null,
  idempotencyPrefix: null,
  maxRuntimeMs: null,
  maxAttempts: null,
  runUnit: null,
  defaultSchedule: null,
  minIntervalHours: null,
}

export type ConnectorInventoryEntry = JobBackedConnectorEntry | StreamConnectorEntry;

const DEFAULT_MAX_RUNTIME_MS = 15 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;

const DAILY_AT_0600_UTC: Schedule = { cadence: 'daily', atMinute: 6 * 60, weekday: null, timeZone: 'UTC' };

/**
 * Every connector but the stream consumer is one job on the queue, and the mapping says so: a source
 * known at the call site reaches its job wiring without a null check.
 */
export const CONNECTOR_INVENTORY: Readonly<{
  [S in ConnectorSource]: S extends 'opencti' ? StreamConnectorEntry : JobBackedConnectorEntry
}> = {
  first: {
    source: 'first',
    domain: 'vulnerability',
    mechanism: 'scheduled_pull',
    jobKind: 'cve-epss-sync',
    idempotencyPrefix: 'first-sync',
    maxRuntimeMs: DEFAULT_MAX_RUNTIME_MS,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    runUnit: 'cves',
    // FIRST publishes the scores once a day.
    defaultSchedule: DAILY_AT_0600_UTC,
    minIntervalHours: 12,
    loggerFeature: 'cve-first',
    scopeKinds: ['cves'],
  },
  nist: {
    source: 'nist',
    domain: 'vulnerability',
    mechanism: 'scheduled_pull',
    jobKind: 'cve-cvss-sync',
    idempotencyPrefix: 'nist-sync',
    maxRuntimeMs: 30 * 60 * 1000,
    maxAttempts: 5,
    runUnit: 'cves',
    // NVD rate-limits its API, and a walk of its whole catalogue outlasts an hour.
    defaultSchedule: DAILY_AT_0600_UTC,
    minIntervalHours: 6,
    loggerFeature: 'cve-nist',
    scopeKinds: ['cves'],
  },
  cisa: {
    source: 'cisa',
    domain: 'vulnerability',
    mechanism: 'scheduled_pull',
    jobKind: 'cve-kev-sync',
    idempotencyPrefix: 'cisa-sync',
    maxRuntimeMs: DEFAULT_MAX_RUNTIME_MS,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    runUnit: 'cves',
    defaultSchedule: DAILY_AT_0600_UTC,
    minIntervalHours: 6,
    loggerFeature: 'cve-cisa',
    scopeKinds: ['cves'],
  },
  microsoft_graph: {
    source: 'microsoft_graph',
    domain: 'vulnerability',
    mechanism: 'scheduled_pull',
    jobKind: 'microsoft-graph-sync',
    idempotencyPrefix: 'graph-sync',
    // Every run re-reads every device and every identity, and a dense tenant (300 devices, 175k
    // findings, 2k accounts) spends about 13 minutes of that in the writes alone.
    maxRuntimeMs: 30 * 60 * 1000,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    // Machines and identities both, which is why this counts assets and not devices.
    runUnit: 'assets',
    defaultSchedule: { cadence: 'every_6_hours', atMinute: null, weekday: null, timeZone: null },
    minIntervalHours: 1,
    loggerFeature: 'microsoft-graph-sync',
    scopeKinds: ['supporting_assets', 'findings'],
  },
  openaev: {
    source: 'openaev',
    domain: 'simulation',
    mechanism: 'scheduled_pull',
    jobKind: 'openaev-findings-sync',
    idempotencyPrefix: 'openaev-sync',
    maxRuntimeMs: 30 * 60 * 1000,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    runUnit: 'observations',
    defaultSchedule: { cadence: 'hourly', atMinute: null, weekday: null, timeZone: null },
    minIntervalHours: 1,
    loggerFeature: 'openaev-sync',
    // The inventory step writes the supporting assets the findings hang on.
    scopeKinds: ['supporting_assets', 'findings'],
  },
  drata: {
    source: 'drata',
    domain: 'compliance',
    mechanism: 'scheduled_pull',
    jobKind: 'drata-sync',
    idempotencyPrefix: 'drata-sync',
    maxRuntimeMs: 10 * 60 * 1000,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    runUnit: 'frameworks',
    defaultSchedule: DAILY_AT_0600_UTC,
    minIntervalHours: 6,
    loggerFeature: 'drata-sync',
    scopeKinds: ['capability_assessments'],
  },
  opencti: {
    source: 'opencti',
    domain: 'threat_intelligence',
    mechanism: 'live_stream',
    jobKind: null,
    idempotencyPrefix: null,
    maxRuntimeMs: null,
    maxAttempts: null,
    runUnit: null,
    defaultSchedule: null,
    minIntervalHours: null,
    loggerFeature: 'opencti',
    scopeKinds: ['threat_intelligence'],
  },
  default_threats: {
    source: 'default_threats',
    domain: 'threat_intelligence',
    mechanism: 'scheduled_pull',
    jobKind: 'default-threats-sync',
    idempotencyPrefix: 'default-threats-sync',
    maxRuntimeMs: DEFAULT_MAX_RUNTIME_MS,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    runUnit: 'threats',
    defaultSchedule: DAILY_AT_0600_UTC,
    // A sync of an unchanged file is one conditional request.
    minIntervalHours: 1,
    loggerFeature: 'default-threats',
    scopeKinds: ['threat_intelligence'],
  },
};

export const CONNECTOR_ENTRIES: ReadonlyArray<ConnectorInventoryEntry> = CONNECTOR_SOURCES
  .map((source) => CONNECTOR_INVENTORY[source]);

export const JOB_BACKED_CONNECTOR_KINDS: ReadonlyArray<string> = CONNECTOR_ENTRIES
  .map((entry) => entry.jobKind)
  .filter((jobKind): jobKind is string => jobKind !== null);

/** The entry a trigger needs, or null for a connector there is nothing to enqueue for. */
export const jobBackedConnector = (source: ConnectorSource): JobBackedConnectorEntry | null => {
  const entry = CONNECTOR_INVENTORY[source];
  return entry.jobKind === null ? null : entry;
};
