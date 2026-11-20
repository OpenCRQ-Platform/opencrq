import { CONNECTOR_SOURCES } from '@app/module/client';
import type { ConnectorMechanism, ConnectorSource, TriggeredBy } from '@app/module/client';

/**
 * The address segment for a connector: its source with underscores as hyphens. Derived rather than
 * declared, so the seven addresses the product already publishes cannot drift from the sources.
 */
export const connectorSlug = (source: ConnectorSource): string => source.replaceAll('_', '-');

export const connectorSourceFromSlug = (slug: string): ConnectorSource | null =>
  CONNECTOR_SOURCES.find((source) => connectorSlug(source) === slug) ?? null;

/** A connector that runs shows what it ran; the one that does not shows its stream instead. */
export const middleTabKey = (mechanism: ConnectorMechanism): 'works' | 'stream' =>
  mechanism === 'live_stream' ? 'stream' : 'works';

export interface ControlledRun {
  triggeredBy: TriggeredBy,
  triggeredById: string | null,
  askedByOthers: boolean,
}

/** `shared`: the viewer's own run, which a cancel would also take from the other askers folded into it. */
export type RunControl = 'allowed' | 'shared' | 'denied';

/**
 * Whether the viewer may cancel or retry a run, as the server decides it: jobs access, or a run the
 * viewer started. The browser always acts as a user, so only a `user` run can be the viewer's own.
 * A retry drops nobody's ask, so only a cancel is ever `shared`.
 */
export const runControl = (
  run: ControlledRun | null,
  viewer: { userId: string, hasManageSecurity: boolean, hasPlatformAccess: boolean },
  action: 'cancel' | 'retry',
): RunControl => {
  if (run === null) {
    return 'denied';
  }
  if (viewer.hasManageSecurity || viewer.hasPlatformAccess) {
    return 'allowed';
  }
  if (run.triggeredBy !== 'user' || run.triggeredById !== viewer.userId) {
    return 'denied';
  }
  return action === 'cancel' && run.askedByOthers ? 'shared' : 'allowed';
};

export interface ConnectorControlsInput {
  hasJob: boolean,
  isStream: boolean,
  streamEnabled: boolean,
  platformConfigured: boolean,
  tenantConfigured: boolean,
  hasActiveRun: boolean,
  lastRunFailed: boolean,
  hasManageSecurity: boolean,
  hasPlatformAccess: boolean,
  userId: string,
  activeRun: ControlledRun | null,
  lastRun: ControlledRun | null,
}

export interface ConnectorControls {
  canSync: boolean,
  showCancel: boolean,
  /** The viewer's own run in flight, which other askers now wait on too: Cancel is shown disabled. */
  cancelHeldByOthers: boolean,
  showRetry: boolean,
  showReconnect: boolean,
  showReset: boolean,
  showConfigure: boolean,
}

/**
 * Which header controls apply. Sync is withheld while a run is in flight because the queue refuses a
 * second run of the same connector and hands back the one already going, which would read as a button
 * that does nothing. Reconnect is withheld from a stream that is switched off, switching one back on
 * being the enable switch's. Reconnect and reset throw the connector's own position away, so they are
 * gated on managing security like that switch. Configure binds a service account, which the server
 * refuses without that capability, whatever the connector's state. Cancel and Retry follow the
 * server's rule: jobs access, or a run the viewer started.
 */
export const connectorControls = ({
  hasJob,
  isStream,
  streamEnabled,
  platformConfigured,
  tenantConfigured,
  hasActiveRun,
  lastRunFailed,
  hasManageSecurity,
  hasPlatformAccess,
  userId,
  activeRun,
  lastRun,
}: ConnectorControlsInput): ConnectorControls => {
  const viewer = { userId, hasManageSecurity, hasPlatformAccess };
  const usable = (hasJob || isStream) && platformConfigured && tenantConfigured;
  const cancel = hasActiveRun ? runControl(activeRun, viewer, 'cancel') : 'denied';
  return {
    canSync: usable && hasJob && !hasActiveRun,
    showCancel: cancel === 'allowed',
    cancelHeldByOthers: cancel === 'shared',
    showRetry: !hasActiveRun && lastRunFailed && runControl(lastRun, viewer, 'retry') === 'allowed',
    showReconnect: usable && isStream && hasManageSecurity && streamEnabled,
    showReset: usable && hasManageSecurity,
    showConfigure: hasManageSecurity,
  };
};
