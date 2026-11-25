import { describe, expect, it } from 'vitest';
import type { OnboardingStep } from './onboarding-steps';
import type { OnboardingWizard, StepSyncReads } from './onboarding-utils';
import {
  backfillProgressPercent,
  canSyncConnector,
  drataEnvBlock,
  firstStepKey,
  getCompletedStepKeys,
  getConnectorCardMode,
  getDefaultThreatsCardMode,
  getDefaultThreatsTileAction,
  getStartedProgress,
  getStartedStepKeys,
  getStepStatus,
  isStepDone,
  microsoftDefenderEnvBlock,
  nextStepKey,
  OPENCTI_DOCUMENTATION_URL,
  openctiEnvBlock,
  openctiImportPercent,
  previousStepKey,
  runProgressPercent,
  shouldOpenGetStarted,
  stepProgressFraction,
  stepSync,
} from './onboarding-utils';

type Status = 'done' | 'started' | 'todo';

const wizard = (
  company: Status,
  assets: Status = 'todo',
  threats: Status = 'todo',
  finances: Status = 'todo',
  tolerance: Status = 'todo',
  defenses: Status = 'todo',
  protect: Status = 'todo',
  scenarios: Status = 'todo',
): OnboardingWizard => {
  const steps = { company, assets, threats, defenses, finances, tolerance, protect, scenarios };
  return {
    id: 'wizard-id',
    organizationId: 'scope-id',
    steps,
    finished: Object.values(steps).every((status) => status !== 'todo'),
  };
};

const step = (key: OnboardingStep['key'], available: boolean): OnboardingStep => ({ key, label: () => key, available });

describe('getStepStatus', () => {
  it('is done for an available step the backend reports done', () => {
    expect(getStepStatus(step('company', true), wizard('done'))).toBe('done');
  });

  it('is todo for an available step the backend reports todo', () => {
    expect(getStepStatus(step('company', true), wizard('todo'))).toBe('todo');
  });

  it('is done for the available Assets step once the backend reports it done', () => {
    expect(getStepStatus(step('assets', true), wizard('todo', 'done'))).toBe('done');
  });

  it('is todo for the available Assets step while the backend reports it todo', () => {
    expect(getStepStatus(step('assets', true), wizard('done', 'todo'))).toBe('todo');
  });

  it('is coming soon for a step flagged unavailable, even when the backend reports it', () => {
    expect(getStepStatus(step('company', false), wizard('done'))).toBe('comingSoon');
  });

  it.each(['defenses', 'protect', 'scenarios'] as const)('is coming soon for the %s step while it is flagged unavailable, even when the backend reports it done', (key) => {
    expect(getStepStatus(step(key, false), wizard('done', 'done', 'done', 'done', 'done', 'done', 'done', 'done'))).toBe('comingSoon');
  });

  it.each(['protect', 'scenarios'] as const)('reads the %s status the backend reports once the step is available', (key) => {
    const allDone = wizard('done', 'done', 'done', 'done', 'done', 'done', 'done', 'done');
    const todo = { ...allDone, steps: { ...allDone.steps, [key]: 'todo' as const } };
    expect(getStepStatus(step(key, true), todo)).toBe('todo');
    expect(getStepStatus(step(key, true), allDone)).toBe('done');
  });

  it('is coming soon for the Threats step while it is flagged unavailable, even when the backend reports it done', () => {
    expect(getStepStatus(step('threats', false), wizard('done', 'done', 'done'))).toBe('comingSoon');
  });

  it('is done for the available Threats step once the backend reports it done', () => {
    expect(getStepStatus(step('threats', true), wizard('todo', 'todo', 'done'))).toBe('done');
  });
});

describe('getStepStatus for Defenses', () => {
  it('is done for the available Defenses step once the backend reports it done', () => {
    expect(getStepStatus(step('defenses', true), wizard('todo', 'todo', 'todo', 'todo', 'todo', 'done'))).toBe('done');
  });

  it('is todo for the available Defenses step while the backend reports it todo', () => {
    expect(getStepStatus(step('defenses', true), wizard('done', 'done', 'done', 'done', 'done', 'todo'))).toBe('todo');
  });
});

describe('getStepStatus for Finances and Tolerance', () => {
  it('is done for the available Finances step once the backend reports it done', () => {
    expect(getStepStatus(step('finances', true), wizard('todo', 'todo', 'todo', 'done'))).toBe('done');
  });

  it('is todo for the available Finances step while the backend reports it todo', () => {
    expect(getStepStatus(step('finances', true), wizard('done', 'done', 'done', 'todo', 'done'))).toBe('todo');
  });

  it('is done for the available Tolerance step once the backend reports it done', () => {
    expect(getStepStatus(step('tolerance', true), wizard('todo', 'todo', 'todo', 'todo', 'done'))).toBe('done');
  });

  it('is todo for the available Tolerance step while the backend reports it todo', () => {
    expect(getStepStatus(step('tolerance', true), wizard('done', 'done', 'done', 'done', 'todo'))).toBe('todo');
  });

  it('is coming soon for Finances while it is flagged unavailable, even when the backend reports it done', () => {
    expect(getStepStatus(step('finances', false), wizard('done', 'done', 'done', 'done', 'done'))).toBe('comingSoon');
  });
});

describe('started steps', () => {
  it('reads a started status as started, for the row to say so', () => {
    expect(getStepStatus(step('finances', true), wizard('todo', 'todo', 'todo', 'started'))).toBe('started');
    expect(getStepStatus(step('defenses', true), wizard('todo', 'todo', 'todo', 'todo', 'todo', 'started'))).toBe('started');
  });

  it('counts a started step apart from the done ones, in the progress and in the stepper', () => {
    const started = wizard('done', 'todo', 'todo', 'started', 'todo', 'started');
    expect(getStartedProgress(started)).toEqual({ completed: 1, started: 2, total: 8, finished: false });
    expect(getCompletedStepKeys(started)).toEqual(['company']);
    expect(getStartedStepKeys(started)).toEqual(['defenses', 'finances']);
  });

  it('counts only a done status as done', () => {
    expect(isStepDone('comingSoon')).toBe(false);
    expect(isStepDone('todo')).toBe(false);
    expect(isStepDone('started')).toBe(false);
    expect(isStepDone('done')).toBe(true);
  });

  it('keeps the backend verdict on a finished wizard that still has started steps', () => {
    const finished = wizard('done', 'started', 'done', 'started', 'done', 'done', 'done', 'done');
    expect(getStartedProgress(finished)).toEqual({ completed: 6, started: 2, total: 8, finished: true });
  });

  it('does not open Get started for a wizard that is finished with started steps', () => {
    expect(shouldOpenGetStarted({ seen: false, wizard: wizard('done', 'done', 'done', 'started', 'done', 'started', 'done', 'done') })).toBe(false);
  });
});

describe('getStartedProgress', () => {
  it('is undefined without a wizard', () => {
    expect(getStartedProgress(undefined)).toBeUndefined();
    expect(getStartedProgress(null)).toBeUndefined();
  });

  it('counts no completed step out of the eight of the wizard while Company is todo', () => {
    expect(getStartedProgress(wizard('todo'))).toEqual({ completed: 0, started: 0, total: 8, finished: false });
  });

  it('counts Company as the one completed step once it is done', () => {
    expect(getStartedProgress(wizard('done'))).toEqual({ completed: 1, started: 0, total: 8, finished: false });
  });
});

describe('getStartedProgress with Assets', () => {
  it('counts Company and Assets as two completed steps out of eight', () => {
    expect(getStartedProgress(wizard('done', 'done'))).toEqual({ completed: 2, started: 0, total: 8, finished: false });
  });

  it('counts Assets alone when Company is still todo', () => {
    expect(getStartedProgress(wizard('todo', 'done'))).toEqual({ completed: 1, started: 0, total: 8, finished: false });
  });
});

describe('getStartedProgress with Threats', () => {
  it('counts Company, Assets and Threats as three completed steps out of eight', () => {
    expect(getStartedProgress(wizard('done', 'done', 'done'))).toEqual({ completed: 3, started: 0, total: 8, finished: false });
  });

  it('counts Threats alone when Company and Assets are still todo', () => {
    expect(getStartedProgress(wizard('todo', 'todo', 'done'))).toEqual({ completed: 1, started: 0, total: 8, finished: false });
  });
});

describe('getStartedProgress with Finances and Tolerance', () => {
  it('counts the five steps done as five completed steps out of eight while Defenses is todo', () => {
    expect(getStartedProgress(wizard('done', 'done', 'done', 'done', 'done'))).toEqual({ completed: 5, started: 0, total: 8, finished: false });
  });

  it('counts the six available steps as six completed steps out of eight', () => {
    expect(getStartedProgress(wizard('done', 'done', 'done', 'done', 'done', 'done'))).toEqual({ completed: 6, started: 0, total: 8, finished: false });
  });

  it('counts Finances and Tolerance alone when the other steps are still todo', () => {
    expect(getStartedProgress(wizard('todo', 'todo', 'todo', 'done', 'done'))).toEqual({ completed: 2, started: 0, total: 8, finished: false });
  });
});

describe('stepProgressFraction', () => {
  it('is the share of answers given', () => {
    expect(stepProgressFraction({ done: 5, total: 20 })).toBe(0.25);
  });

  it('is empty when there is nothing to count towards', () => {
    expect(stepProgressFraction({ done: 0, total: 0 })).toBe(0);
  });

  it('stays between 0 and 1', () => {
    expect(stepProgressFraction({ done: 13, total: 12 })).toBe(1);
    expect(stepProgressFraction({ done: -1, total: 12 })).toBe(0);
  });
});

describe('shouldOpenGetStarted', () => {
  it('opens Get started for an unfinished wizard on a browser that has not seen it', () => {
    expect(shouldOpenGetStarted({ seen: false, wizard: wizard('todo') })).toBe(true);
  });

  it('does not open it once the browser has seen it', () => {
    expect(shouldOpenGetStarted({ seen: true, wizard: wizard('todo') })).toBe(false);
  });

  it('does not open it when the tenant has no wizard', () => {
    expect(shouldOpenGetStarted({ seen: false, wizard: null })).toBe(false);
  });

  it('does not open it while the wizard is still loading', () => {
    expect(shouldOpenGetStarted({ seen: false, wizard: undefined })).toBe(false);
  });

  it('opens it while Company is done and Assets is not', () => {
    expect(shouldOpenGetStarted({ seen: false, wizard: wizard('done', 'todo') })).toBe(true);
  });

  it('opens it while Company and Assets are done and Threats is not', () => {
    expect(shouldOpenGetStarted({ seen: false, wizard: wizard('done', 'done') })).toBe(true);
  });

  it('opens it while Company, Assets and Threats are done and Finances is not', () => {
    expect(shouldOpenGetStarted({ seen: false, wizard: wizard('done', 'done', 'done', 'todo', 'done') })).toBe(true);
  });

  it('opens it while Company, Assets and Threats are done and Tolerance is not', () => {
    expect(shouldOpenGetStarted({ seen: false, wizard: wizard('done', 'done', 'done', 'done', 'todo') })).toBe(true);
  });

  it.each([
    ['Defenses', wizard('done', 'done', 'done', 'done', 'done', 'todo', 'done', 'done')],
    ['Protect', wizard('done', 'done', 'done', 'done', 'done', 'done', 'todo', 'done')],
    ['Scenarios', wizard('done', 'done', 'done', 'done', 'done', 'done', 'done', 'todo')],
  ])('opens it while only %s is not done', (_name, unfinished) => {
    expect(shouldOpenGetStarted({ seen: false, wizard: unfinished })).toBe(true);
  });

  it('does not open it for a finished wizard', () => {
    expect(shouldOpenGetStarted({ seen: false, wizard: wizard('done', 'done', 'done', 'done', 'done', 'done', 'done', 'done') })).toBe(false);
  });

  it('does not open it for a finished wizard already seen', () => {
    expect(shouldOpenGetStarted({ seen: true, wizard: wizard('done', 'done', 'done', 'done', 'done', 'done', 'done', 'done') })).toBe(false);
  });
});

describe('getConnectorCardMode', () => {
  it('is unavailable when the platform has not enabled the connector, whatever the capability', () => {
    expect(getConnectorCardMode({ platformConfigured: false, hasManageSecurity: true })).toBe('unavailable');
    expect(getConnectorCardMode({ platformConfigured: false, hasManageSecurity: false })).toBe('unavailable');
  });

  it('is configure for a MANAGE_SECURITY holder once the platform enabled the connector', () => {
    expect(getConnectorCardMode({ platformConfigured: true, hasManageSecurity: true })).toBe('configure');
  });

  it('is readonly for a reader without MANAGE_SECURITY once the platform enabled the connector', () => {
    expect(getConnectorCardMode({ platformConfigured: true, hasManageSecurity: false })).toBe('readonly');
  });
});

describe('canSyncConnector', () => {
  it('allows a sync when the platform and the tenant are configured and no run is in flight', () => {
    expect(canSyncConnector({ platformConfigured: true, tenantConfigured: true, hasActiveRun: false })).toBe(true);
  });

  it('refuses while the platform has not enabled the connector', () => {
    expect(canSyncConnector({ platformConfigured: false, tenantConfigured: true, hasActiveRun: false })).toBe(false);
  });

  it('refuses until a service account is bound on the tenant', () => {
    expect(canSyncConnector({ platformConfigured: true, tenantConfigured: false, hasActiveRun: false })).toBe(false);
  });

  it('refuses while a run is in flight', () => {
    expect(canSyncConnector({ platformConfigured: true, tenantConfigured: true, hasActiveRun: true })).toBe(false);
  });
});

describe('microsoftDefenderEnvBlock', () => {
  it('writes the three variables of the tenant, one per line, each left empty', () => {
    expect(microsoftDefenderEnvBlock('tenant-id').split('\n')).toEqual([
      'CONNECTORS__MICROSOFT_GRAPH__tenant-id__AZURE_TENANT_ID=',
      'CONNECTORS__MICROSOFT_GRAPH__tenant-id__CLIENT_ID=',
      'CONNECTORS__MICROSOFT_GRAPH__tenant-id__CLIENT_SECRET=',
    ]);
  });
});

const steps = [step('company', true), step('assets', true), step('threats', false), step('defenses', false), step('finances', true), step('tolerance', false)];

describe('nextStepKey', () => {
  it('leads to the next step when it is available', () => {
    expect(nextStepKey('company', steps)).toBe('assets');
  });

  it('skips the steps that are not available', () => {
    expect(nextStepKey('assets', steps)).toBe('finances');
  });

  it('is null after the last available step, even when unavailable steps follow it', () => {
    expect(nextStepKey('finances', steps)).toBeNull();
  });
});

describe('previousStepKey', () => {
  it('leads to the previous step when it is available', () => {
    expect(previousStepKey('assets', steps)).toBe('company');
  });

  it('skips the steps that are not available', () => {
    expect(previousStepKey('finances', steps)).toBe('assets');
  });

  it('is null before the first available step', () => {
    expect(previousStepKey('company', steps)).toBeNull();
  });
});

describe('navigation on the steps of the wizard', () => {
  it('leads Assets to Threats, now that Threats is available', () => {
    expect(nextStepKey('assets')).toBe('threats');
  });

  it('leads Threats to Defenses, now that Defenses is available', () => {
    expect(nextStepKey('threats')).toBe('defenses');
  });

  it('leads Defenses to Finances', () => {
    expect(nextStepKey('defenses')).toBe('finances');
  });

  it('leads Finances to Tolerance', () => {
    expect(nextStepKey('finances')).toBe('tolerance');
  });

  it('leads Tolerance to Protect', () => {
    expect(nextStepKey('tolerance')).toBe('protect');
  });

  it('leads Protect to Scenarios', () => {
    expect(nextStepKey('protect')).toBe('scenarios');
  });

  it('leaves Scenarios for the overview, no step after it', () => {
    expect(nextStepKey('scenarios')).toBeNull();
  });

  it('leads Threats back to Assets', () => {
    expect(previousStepKey('threats')).toBe('assets');
  });

  it('leads Defenses back to Threats', () => {
    expect(previousStepKey('defenses')).toBe('threats');
  });

  it('leads Finances back to Defenses', () => {
    expect(previousStepKey('finances')).toBe('defenses');
  });

  it('leads Tolerance back to Finances', () => {
    expect(previousStepKey('tolerance')).toBe('finances');
  });

  it('leads Protect back to Tolerance', () => {
    expect(previousStepKey('protect')).toBe('tolerance');
  });

  it('leads the first step back to the overview', () => {
    expect(previousStepKey('company')).toBeNull();
  });
});

describe('firstStepKey', () => {
  it('is the first available step', () => {
    expect(firstStepKey([step('company', false), step('assets', true)])).toBe('assets');
  });

  it('is null when no step is available', () => {
    expect(firstStepKey([step('company', false)])).toBeNull();
  });
});

describe('getCompletedStepKeys', () => {
  it('lists the available steps the backend reports done', () => {
    expect(getCompletedStepKeys(wizard('done', 'done'))).toEqual(['company', 'assets']);
    expect(getCompletedStepKeys(wizard('todo', 'done'))).toEqual(['assets']);
    expect(getCompletedStepKeys(wizard('done', 'done', 'done'))).toEqual(['company', 'assets', 'threats']);
  });
});

describe('openctiEnvBlock', () => {
  it('names the URL and the token of this tenant, one per line', () => {
    expect(openctiEnvBlock('tenant-1').split('\n')).toEqual([
      'CONNECTORS__OPENCTI__tenant-1__URL=',
      'CONNECTORS__OPENCTI__tenant-1__TOKEN=',
    ]);
  });

  it('points to the section of the OpenCTI connector page that lists its variables', () => {
    expect(OPENCTI_DOCUMENTATION_URL).toBe('https://filigran.io/docs/opencrq/use/sources/opencti/#give-opencrq-the-url-and-the-token');
  });
});

describe('getDefaultThreatsCardMode', () => {
  const loaded = { datasetFileUrl: 'https://example.test/file.json', enabled: true, loadedAt: '2026-11-10T08:00:00.000Z', connectorState: 'healthy', hasManageSecurity: false } as const;

  it('is unavailable when the platform turned the dataset off, whatever the rest', () => {
    expect(getDefaultThreatsCardMode({ ...loaded, datasetFileUrl: null, hasManageSecurity: true })).toBe('unavailable');
    expect(getDefaultThreatsCardMode({ ...loaded, datasetFileUrl: null, enabled: false })).toBe('unavailable');
  });

  it('is loaded once the dataset was loaded', () => {
    expect(getDefaultThreatsCardMode(loaded)).toBe('loaded');
  });

  it('stays loaded when a later refresh fails', () => {
    expect(getDefaultThreatsCardMode({ ...loaded, connectorState: 'failing' })).toBe('loaded');
  });

  it('is loading while an enabled connector has not loaded yet', () => {
    expect(getDefaultThreatsCardMode({ ...loaded, loadedAt: null, connectorState: 'never_synced' })).toBe('loading');
    expect(getDefaultThreatsCardMode({ ...loaded, loadedAt: null, connectorState: 'syncing' })).toBe('loading');
  });

  it('is failed when the first load ended in failure', () => {
    expect(getDefaultThreatsCardMode({ ...loaded, loadedAt: null, connectorState: 'failing' })).toBe('failed');
  });

  it('offers Enable to a MANAGE_SECURITY holder when the connector is disabled', () => {
    expect(getDefaultThreatsCardMode({ ...loaded, enabled: false, hasManageSecurity: true })).toBe('disabled-enable');
  });

  it('tells any other reader that an administrator enables it when the connector is disabled', () => {
    expect(getDefaultThreatsCardMode({ ...loaded, enabled: false, hasManageSecurity: false })).toBe('disabled-readonly');
  });
});

describe('getDefaultThreatsTileAction', () => {
  it('offers Enable to a MANAGE_SECURITY holder on a switched-off set', () => {
    expect(getDefaultThreatsTileAction('disabled-enable', true)).toBe('enable');
  });

  it('tells any other reader that an administrator enables a switched-off set', () => {
    expect(getDefaultThreatsTileAction('disabled-readonly', false)).toBe('ask-administrator');
  });

  it('offers Disable to a MANAGE_SECURITY holder on an enabled set, loading or loaded', () => {
    expect(getDefaultThreatsTileAction('loading', true)).toBe('disable');
    expect(getDefaultThreatsTileAction('loaded', true)).toBe('disable');
  });

  it('offers nothing to another reader on an enabled set', () => {
    expect(getDefaultThreatsTileAction('loading', false)).toBe('none');
    expect(getDefaultThreatsTileAction('loaded', false)).toBe('none');
  });

  it('links to Integrations when the first load failed, whoever the reader is', () => {
    expect(getDefaultThreatsTileAction('failed', true)).toBe('open-integrations');
    expect(getDefaultThreatsTileAction('failed', false)).toBe('open-integrations');
  });

  it('offers nothing when the platform turned the set off', () => {
    expect(getDefaultThreatsTileAction('unavailable', true)).toBe('none');
  });
});

describe('runProgressPercent', () => {
  it('is the processed share of the expected total, rounded down', () => {
    expect(runProgressPercent({ processedTotal: 62, expectedTotal: 100 })).toBe(62);
    expect(runProgressPercent({ processedTotal: 1, expectedTotal: 3 })).toBe(33);
  });

  it('is unknown without a run, without an expected total or with a nil one', () => {
    expect(runProgressPercent(null)).toBeNull();
    expect(runProgressPercent({ processedTotal: 10, expectedTotal: null })).toBeNull();
    expect(runProgressPercent({ processedTotal: 10, expectedTotal: 0 })).toBeNull();
  });

  it('stays within 0 and 100 when the run overshoots its estimate', () => {
    expect(runProgressPercent({ processedTotal: 120, expectedTotal: 100 })).toBe(100);
    expect(runProgressPercent({ processedTotal: 0, expectedTotal: 100 })).toBe(0);
  });
});

describe('backfillProgressPercent', () => {
  it('is the stream percentage while it catches up', () => {
    expect(backfillProgressPercent({ isCatchingUp: true, progressPercent: 40 })).toBe(40);
  });

  it('is unknown once the stream reached its live tail, whatever the last percentage', () => {
    expect(backfillProgressPercent({ isCatchingUp: false, progressPercent: 100 })).toBeNull();
  });

  it('is unknown while the stream cannot tell, or before the read answers', () => {
    expect(backfillProgressPercent({ isCatchingUp: true, progressPercent: null })).toBeNull();
    expect(backfillProgressPercent(undefined)).toBeNull();
  });
});

describe('openctiImportPercent', () => {
  const catchingUp = { isCatchingUp: true, progressPercent: 40 };

  it('is the backfill percentage while the stream can import', () => {
    expect(openctiImportPercent('syncing', catchingUp)).toBe(40);
    expect(openctiImportPercent(undefined, catchingUp)).toBe(40);
  });

  it('is unknown while the stream cannot connect, whatever its last percentage', () => {
    expect(openctiImportPercent('failing', catchingUp)).toBeNull();
    expect(openctiImportPercent('unavailable', catchingUp)).toBeNull();
    expect(openctiImportPercent('not_configured', catchingUp)).toBeNull();
  });
});

describe('stepSync', () => {
  const idle: StepSyncReads = {
    defender: { state: 'healthy', activeRun: null },
    opencti: { state: 'healthy' },
    defaultThreats: { state: 'healthy' },
    backfill: { isCatchingUp: false, progressPercent: 100 },
  };

  it('is nothing while no import runs, and before the reads answer', () => {
    expect(stepSync('assets', idle)).toBeNull();
    expect(stepSync('threats', idle)).toBeNull();
    expect(stepSync('threats', { defender: undefined, opencti: undefined, defaultThreats: undefined, backfill: undefined })).toBeNull();
  });

  it('is Defender for Assets while it syncs, with the percentage of its run', () => {
    const reads = { ...idle, defender: { state: 'syncing' as const, activeRun: { processedTotal: 62, expectedTotal: 100 } } };
    expect(stepSync('assets', reads)).toEqual({ source: 'microsoft_graph', percent: 62 });
  });

  it('has no percentage for Defender until its run knows its total', () => {
    const reads = { ...idle, defender: { state: 'syncing' as const, activeRun: { processedTotal: 5, expectedTotal: null } } };
    expect(stepSync('assets', reads)).toEqual({ source: 'microsoft_graph', percent: null });
  });

  it('is OpenCTI for Threats while its stream catches up, with the stream percentage', () => {
    const reads = { ...idle, backfill: { isCatchingUp: true, progressPercent: 40 } };
    expect(stepSync('threats', reads)).toEqual({ source: 'opencti', percent: 40 });
  });

  it('is not OpenCTI while its stream cannot connect, however far behind it is', () => {
    const behind = { isCatchingUp: true, progressPercent: 40 };
    expect(stepSync('threats', { ...idle, opencti: { state: 'failing' }, backfill: behind })).toBeNull();
    expect(stepSync('threats', { ...idle, opencti: { state: 'not_configured' }, backfill: behind })).toBeNull();
  });

  it('is OpenCTI for Threats while its connector syncs without a known percentage', () => {
    expect(stepSync('threats', { ...idle, opencti: { state: 'syncing' } })).toEqual({ source: 'opencti', percent: null });
  });

  it('is the OpenCRQ set for Threats while it loads, never with a percentage', () => {
    expect(stepSync('threats', { ...idle, defaultThreats: { state: 'syncing' } })).toEqual({ source: 'default_threats', percent: null });
  });

  it('prefers OpenCTI when both Threats sources import', () => {
    const reads = { ...idle, opencti: { state: 'syncing' as const }, defaultThreats: { state: 'syncing' as const } };
    expect(stepSync('threats', reads)?.source).toBe('opencti');
  });

  it('keeps each source on its own step', () => {
    const reads: StepSyncReads = {
      defender: { state: 'syncing', activeRun: null },
      opencti: { state: 'syncing' },
      defaultThreats: { state: 'syncing' },
      backfill: { isCatchingUp: true, progressPercent: 10 },
    };
    expect(stepSync('assets', reads)?.source).toBe('microsoft_graph');
    expect(stepSync('threats', reads)?.source).toBe('opencti');
    expect(stepSync('company', reads)).toBeNull();
    expect(stepSync('finances', reads)).toBeNull();
    expect(stepSync('tolerance', reads)).toBeNull();
  });
});

describe('drataEnvBlock', () => {
  it('writes the required variable of the tenant, left empty', () => {
    expect(drataEnvBlock('tenant-1')).toBe('CONNECTORS__DRATA__tenant-1__API_KEY=');
  });
});
