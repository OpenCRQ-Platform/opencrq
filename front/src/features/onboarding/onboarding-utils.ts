import type { ConnectorState } from '@app/module/client';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { OnboardingStep, OnboardingStepKey } from './onboarding-steps';
import { ONBOARDING_STEPS } from './onboarding-steps';

export type OnboardingWizard = NonNullable<inferRouterOutputs<TRPCRouter>['onboardingWizard']['getOnboardingWizard']>;

export type OnboardingStepStatus = 'done' | 'started' | 'todo' | 'comingSoon';

/** Only a done step is counted and checked: a started one informs the reader of what is left and never blocks the wizard. */
export const isStepDone = (status: OnboardingStepStatus): boolean => status === 'done';

export interface GetStartedProgress {
  /** The done steps only. */
  completed: number,
  started: number,
  total: number,
  /** The backend's verdict (no step to do), which a started step does not hold back. */
  finished: boolean,
}

/** How far a started step is: `done` of `total` answers given. */
export interface StepProgressCount {
  done: number,
  total: number,
}

/** The ring's fill, between 0 and 1: nothing to count towards (a zero total) reads as empty. */
export const stepProgressFraction = ({ done, total }: StepProgressCount): number =>
  total <= 0 ? 0 : Math.min(1, Math.max(0, done / total));

/** A step flagged unavailable stays coming soon whatever the backend computes. */
export const getStepStatus = (step: OnboardingStep, wizard: OnboardingWizard): OnboardingStepStatus => {
  if (!step.available) {
    return 'comingSoon';
  }
  return wizard.steps[step.key];
};

export const getCompletedStepKeys = (wizard: OnboardingWizard): Array<OnboardingStepKey> =>
  ONBOARDING_STEPS.filter((step) => isStepDone(getStepStatus(step, wizard))).map((step) => step.key);

export const getStartedStepKeys = (wizard: OnboardingWizard): Array<OnboardingStepKey> =>
  ONBOARDING_STEPS.filter((step) => getStepStatus(step, wizard) === 'started').map((step) => step.key);

export const firstStepKey = (steps: ReadonlyArray<OnboardingStep> = ONBOARDING_STEPS): OnboardingStepKey | null =>
  steps.find((step) => step.available)?.key ?? null;

/** The first available step after `key`, or `null` past the last one: the caller then leaves for the overview. */
export const nextStepKey = (key: OnboardingStepKey, steps: ReadonlyArray<OnboardingStep> = ONBOARDING_STEPS): OnboardingStepKey | null => {
  const index = steps.findIndex((step) => step.key === key);
  return steps.slice(index + 1).find((step) => step.available)?.key ?? null;
};

/** The last available step before `key`, or `null` before the first one: the caller then leaves for the overview. */
export const previousStepKey = (key: OnboardingStepKey, steps: ReadonlyArray<OnboardingStep> = ONBOARDING_STEPS): OnboardingStepKey | null => {
  const index = steps.findIndex((step) => step.key === key);
  return steps.slice(0, Math.max(index, 0)).findLast((step) => step.available)?.key ?? null;
};

export const getStartedProgress = (wizard: OnboardingWizard | null | undefined): GetStartedProgress | undefined => {
  if (wizard === null || wizard === undefined) {
    return undefined;
  }
  return {
    completed: getCompletedStepKeys(wizard).length,
    started: getStartedStepKeys(wizard).length,
    total: ONBOARDING_STEPS.length,
    finished: wizard.finished,
  };
};

interface GetStartedRedirectInput {
  /** This browser already opened Get started for this user and tenant. */
  seen: boolean,
  wizard: OnboardingWizard | null | undefined,
}

export const shouldOpenGetStarted = ({ seen, wizard }: GetStartedRedirectInput): boolean => {
  if (seen || wizard === null || wizard === undefined) {
    return false;
  }
  return !wizard.finished;
};

/** The section of the connector's page that lists the variables a tenant needs for the Microsoft Defender connector. */
export const MICROSOFT_DEFENDER_DOCUMENTATION_URL = 'https://filigran.io/docs/opencrq/use/sources/microsoft-defender/#give-opencrq-the-credentials';

/** The variables a platform administrator sets to turn the Microsoft Defender connector on for one tenant. */
export const microsoftDefenderEnvBlock = (tenantId: string): string => [
  `CONNECTORS__MICROSOFT_GRAPH__${tenantId}__AZURE_TENANT_ID=`,
  `CONNECTORS__MICROSOFT_GRAPH__${tenantId}__CLIENT_ID=`,
  `CONNECTORS__MICROSOFT_GRAPH__${tenantId}__CLIENT_SECRET=`,
].join('\n');

export type ConnectorCardMode = 'unavailable' | 'configure' | 'readonly';

interface ConnectorCardModeInput {
  platformConfigured: boolean,
  hasManageSecurity: boolean,
}

/** Binding a connector to a service account needs `MANAGE_SECURITY`, so a reader without it only sees where the connector stands. */
export const getConnectorCardMode = ({ platformConfigured, hasManageSecurity }: ConnectorCardModeInput): ConnectorCardMode => {
  if (!platformConfigured) {
    return 'unavailable';
  }
  return hasManageSecurity ? 'configure' : 'readonly';
};

/** Sync is withheld while a run is in flight (the queue hands back the one already going) and until a service account is bound. */
export const canSyncConnector = ({ platformConfigured, tenantConfigured, hasActiveRun }: { platformConfigured: boolean, tenantConfigured: boolean, hasActiveRun: boolean }): boolean =>
  platformConfigured && tenantConfigured && !hasActiveRun;

/** The section of the connector's page that lists the variables a tenant needs for the Drata connector. */
export const DRATA_DOCUMENTATION_URL = 'https://filigran.io/docs/opencrq/use/sources/drata/#before-you-start';

/** The variable a platform administrator sets to turn the Drata connector on for one tenant, the only one required. */
export const drataEnvBlock = (tenantId: string): string => [
  `CONNECTORS__DRATA__${tenantId}__API_KEY=`,
].join('\n');

/** The section of the connector's page that lists the variables a tenant needs for the OpenCTI connector. */
export const OPENCTI_DOCUMENTATION_URL = 'https://filigran.io/docs/opencrq/use/sources/opencti/#give-opencrq-the-url-and-the-token';

/** The variables a platform administrator sets to turn the OpenCTI connector on for one tenant. */
export const openctiEnvBlock = (tenantId: string): string => [
  `CONNECTORS__OPENCTI__${tenantId}__URL=`,
  `CONNECTORS__OPENCTI__${tenantId}__TOKEN=`,
].join('\n');

export type DefaultThreatsCardMode = 'unavailable' | 'loading' | 'failed' | 'loaded' | 'disabled-enable' | 'disabled-readonly';

interface DefaultThreatsCardModeInput {
  /** Null when the platform turned the dataset off. */
  datasetFileUrl: string | null,
  enabled: boolean,
  /** Null until the dataset was loaded once. */
  loadedAt: string | null,
  connectorState: ConnectorState,
  hasManageSecurity: boolean,
}

/**
 * An enabled connector that never loaded is loading until its run ends in the dead-letter queue, which
 * the connector state reads as `failing`: only then is the wait over without a dataset.
 */
export const getDefaultThreatsCardMode = ({
  datasetFileUrl,
  enabled,
  loadedAt,
  connectorState,
  hasManageSecurity,
}: DefaultThreatsCardModeInput): DefaultThreatsCardMode => {
  if (datasetFileUrl === null) {
    return 'unavailable';
  }
  if (!enabled) {
    return hasManageSecurity ? 'disabled-enable' : 'disabled-readonly';
  }
  if (loadedAt !== null) {
    return 'loaded';
  }
  return connectorState === 'failing' ? 'failed' : 'loading';
};

export type DefaultThreatsTileAction = 'enable' | 'disable' | 'ask-administrator' | 'open-integrations' | 'none';

/**
 * Switching the set on or off is `MANAGE_SECURITY`'s, so a reader without it gets a button for neither:
 * only a switched-off set says an administrator enables it, since an enabled one needs nothing from them.
 */
export const getDefaultThreatsTileAction = (mode: DefaultThreatsCardMode, hasManageSecurity: boolean): DefaultThreatsTileAction => {
  switch (mode) {
    case 'unavailable':
      return 'none';
    case 'disabled-enable':
      return 'enable';
    case 'disabled-readonly':
      return 'ask-administrator';
    case 'failed':
      return 'open-integrations';
    case 'loading':
    case 'loaded':
      return hasManageSecurity ? 'disable' : 'none';
  }
};

const clampPercent = (percent: number): number => Math.min(100, Math.max(0, Math.floor(percent)));

/** A job-backed import's progress: unknown until the run knows how many records to expect. */
export const runProgressPercent = (run: { processedTotal: number, expectedTotal: number | null } | null): number | null => {
  if (run === null || run.expectedTotal === null || run.expectedTotal <= 0) {
    return null;
  }
  return clampPercent((run.processedTotal / run.expectedTotal) * 100);
};

interface BackfillProgress {
  isCatchingUp: boolean,
  progressPercent: number | null,
}

/** The percentage only means something while the stream catches up: past the live tail it stays at its last value. */
export const backfillProgressPercent = (progress: BackfillProgress | undefined): number | null => {
  if (progress === undefined || !progress.isCatchingUp || progress.progressPercent === null) {
    return null;
  }
  return clampPercent(progress.progressPercent);
};

export type StepSyncSource = 'microsoft_graph' | 'opencti' | 'default_threats';

export interface StepSync {
  source: StepSyncSource,
  /** Null while the import cannot tell how far it is: the row then shows its chip alone. */
  percent: number | null,
}

interface ConnectorSyncRead {
  state: ConnectorState,
  activeRun: { processedTotal: number, expectedTotal: number | null } | null,
}

export interface StepSyncReads {
  defender: ConnectorSyncRead | undefined,
  opencti: Pick<ConnectorSyncRead, 'state'> | undefined,
  defaultThreats: Pick<ConnectorSyncRead, 'state'> | undefined,
  backfill: BackfillProgress | undefined,
}

/** `isCatchingUp` only says the stream has not reached its live tail, which a stream that cannot connect never does. */
const STREAM_STATES_NOT_IMPORTING: ReadonlyArray<ConnectorState> = ['failing', 'unavailable', 'not_configured'];

const streamCanImport = (state: ConnectorState | undefined): boolean => state === undefined || !STREAM_STATES_NOT_IMPORTING.includes(state);

/** OpenCTI's backfill percentage, or null when the stream cannot connect: its last value would read as an import still running. */
export const openctiImportPercent = (state: ConnectorState | undefined, backfill: BackfillProgress | undefined): number | null => (
  streamCanImport(state) ? backfillProgressPercent(backfill) : null
);

/**
 * The source whose import is running behind a step, if any. Threats reads OpenCTI first (its percentage is
 * the one that can be known), then the OpenCRQ set. A running import changes the row's chip only: the
 * step's status stays the one the backend computes.
 */
export const stepSync = (key: OnboardingStepKey, reads: StepSyncReads): StepSync | null => {
  if (key === 'assets' && reads.defender?.state === 'syncing') {
    return { source: 'microsoft_graph', percent: runProgressPercent(reads.defender.activeRun) };
  }
  if (key === 'threats') {
    const openctiCatchingUp = reads.backfill?.isCatchingUp === true && streamCanImport(reads.opencti?.state);
    if (openctiCatchingUp || reads.opencti?.state === 'syncing') {
      return { source: 'opencti', percent: openctiImportPercent(reads.opencti?.state, reads.backfill) };
    }
    if (reads.defaultThreats?.state === 'syncing') {
      return { source: 'default_threats', percent: null };
    }
  }
  return null;
};
