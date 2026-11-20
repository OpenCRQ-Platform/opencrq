import type { TerminalRunStatus } from '../jobs/schema';

export const CONNECTOR_STATES = [
  'unavailable',
  'not_configured',
  'never_synced',
  'syncing',
  'healthy',
  'failing',
] as const;
export type ConnectorState = (typeof CONNECTOR_STATES)[number];

interface ConnectorStateInput {
  platformConfigured: boolean,
  tenantConfigured: boolean,
  /** False only for a connector with a switch, switched off. */
  enabled: boolean,
  hasActiveRun: boolean,
  /** Null when no run has ever stopped, which is what `never_synced` reads. */
  lastTerminalRunStatus: TerminalRunStatus | null,
}

interface StreamConnectorStateInput {
  platformConfigured: boolean,
  tenantConfigured: boolean,
  authFailed: boolean,
  enabled: boolean,
  reachedLiveTail: boolean,
}

const configurationState = (
  platformConfigured: boolean,
  tenantConfigured: boolean,
): ConnectorState | null => {
  if (!platformConfigured) {
    return 'unavailable';
  }
  if (!tenantConfigured) {
    return 'not_configured';
  }
  return null;
};

/**
 * The state of a connector backed by the job queue. Conditions are ordered and the first match wins,
 * which is what puts `never_synced` below `syncing`: a first run still in flight reads `syncing`.
 *
 * A cancelled run reads `healthy`: the move after a deliberate cancellation is the one that follows a
 * success, so it must not raise the chip that means failure. A connector switched off stands where
 * `never_synced` does, as a disabled stream does.
 */
export const deriveConnectorState = ({
  platformConfigured,
  tenantConfigured,
  enabled,
  hasActiveRun,
  lastTerminalRunStatus,
}: ConnectorStateInput): ConnectorState => {
  const configuration = configurationState(platformConfigured, tenantConfigured);
  if (configuration) {
    return configuration;
  }
  if (!enabled) {
    return 'never_synced';
  }
  if (hasActiveRun) {
    return 'syncing';
  }
  if (lastTerminalRunStatus === null) {
    return 'never_synced';
  }
  return lastTerminalRunStatus === 'dlq' ? 'failing' : 'healthy';
};

/**
 * The state of the stream connector, which produces no runs: the last four states are read off the
 * stream session instead. A configured stream that is not enabled stands where `never_synced` does.
 */
export const deriveStreamConnectorState = ({
  platformConfigured,
  tenantConfigured,
  authFailed,
  enabled,
  reachedLiveTail,
}: StreamConnectorStateInput): ConnectorState => {
  const configuration = configurationState(platformConfigured, tenantConfigured);
  if (configuration) {
    return configuration;
  }
  if (authFailed) {
    return 'failing';
  }
  if (!enabled) {
    return 'never_synced';
  }
  return reachedLiveTail ? 'healthy' : 'syncing';
};

export const STREAM_CONNECTIONS = [
  'not_configured',
  'auth_failed',
  'disabled',
  'not_running',
  'connected',
] as const;
export type StreamConnection = (typeof STREAM_CONNECTIONS)[number];

interface StreamConnectionInput {
  platformConfigured: boolean,
  tenantConfigured: boolean,
  authFailed: boolean,
  enabled: boolean,
  /** Whether any job-runtime process is answering: the stream consumer runs inside that process. */
  runtimeAnswering: boolean,
  serviceAccountActive: boolean,
}

/**
 * How the stream connector stands, for the panel that watches it. Conditions are ordered and the first
 * match wins, which puts `auth_failed` above `disabled`: a rejected token forces the connector off, so
 * the two always co-occur and the rejection is the one that says what to do.
 *
 * Nothing is recorded when a connection succeeds, only when an event is stored, so `connected` claims no
 * more than that nothing rejected the stream and that a process able to run it is alive. A quiet stream
 * and one whose socket just died are indistinguishable from here.
 */
export const deriveStreamConnection = ({
  platformConfigured,
  tenantConfigured,
  authFailed,
  enabled,
  runtimeAnswering,
  serviceAccountActive,
}: StreamConnectionInput): StreamConnection => {
  if (configurationState(platformConfigured, tenantConfigured) !== null) {
    return 'not_configured';
  }
  if (authFailed) {
    return 'auth_failed';
  }
  if (!enabled) {
    return 'disabled';
  }
  // A deactivated account leaves `enabled` true while the consumer refuses to start, which would
  // otherwise read as a connected stream with nothing running behind it.
  return runtimeAnswering && serviceAccountActive ? 'connected' : 'not_running';
};
