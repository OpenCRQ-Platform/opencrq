import { describe, expect, it } from 'vitest';
import type { FamilyRun } from './run-profile';
import {
  bookedRunProfile,
  cvesRunProfile,
  familyRunOwnership,
  foldCrqSimulationPayload,
  FULL_RUN_PROFILE,
  isRequestedCrqSimulation,
  mergeRunProfiles,
  PRICE_RUN_PROFILE,
  runProfileCovers,
  runProfileTokens,
} from './run-profile';

const run = (runId: string, rank: number, profile: ReadonlyArray<string>, riskScenarioId = 'scenario-1'): FamilyRun =>
  ({ runId, riskScenarioId, rank, profile });

describe('mergeRunProfiles', () => {
  it('folds any profile into a full run', () => {
    expect(mergeRunProfiles(FULL_RUN_PROFILE, { techniques: false, cves: false, levers: ['a'], plans: [] })).toEqual(FULL_RUN_PROFILE);
    expect(mergeRunProfiles(PRICE_RUN_PROFILE, FULL_RUN_PROFILE)).toEqual(FULL_RUN_PROFILE);
  });

  it('computes both partial profiles, each subject once', () => {
    expect(mergeRunProfiles(
      { techniques: false, cves: false, levers: ['b', 'a'], plans: [] },
      { techniques: true, cves: false, levers: ['a'], plans: ['p'] },
    )).toEqual({ techniques: true, cves: false, levers: ['a', 'b'], plans: ['p'] });
  });

  it('computes the CVE what-ifs as soon as either profile does', () => {
    const cves = { ...PRICE_RUN_PROFILE, cves: true };
    expect(mergeRunProfiles(PRICE_RUN_PROFILE, cves).cves).toBe(true);
    expect(mergeRunProfiles(cves, PRICE_RUN_PROFILE).cves).toBe(true);
    expect(mergeRunProfiles(PRICE_RUN_PROFILE, PRICE_RUN_PROFILE).cves).toBe(false);
  });
});

describe('runProfileTokens', () => {
  it('records a whole family by its name and a named subject under its family', () => {
    expect(runProfileTokens(FULL_RUN_PROFILE)).toEqual(['techniques', 'cves', 'levers', 'plans']);
    expect(runProfileTokens(PRICE_RUN_PROFILE)).toEqual([]);
    expect(runProfileTokens({ techniques: false, cves: false, levers: ['a'], plans: ['p'] })).toEqual(['levers:a', 'plans:p']);
    expect(runProfileTokens({ ...PRICE_RUN_PROFILE, cves: true })).toEqual(['cves']);
  });
});

describe('cvesRunProfile', () => {
  it('computes the CVE what-ifs and nothing else', () => {
    expect(runProfileTokens(cvesRunProfile)).toEqual(['cves']);
    expect(cvesRunProfile).toEqual({ ...PRICE_RUN_PROFILE, cves: true });
  });
});

describe('familyRunOwnership', () => {
  it('reads every subject of the whole-family run that no newer run named', () => {
    const { owns, runIds } = familyRunOwnership([
      run('full', 2, ['techniques', 'levers', 'plans']),
      run('partial', 1, ['levers:a']),
    ], 'levers');

    expect(owns('partial', 'a')).toBe(true);
    expect(owns('full', 'a')).toBe(false);
    expect(owns('full', 'b')).toBe(true);
    expect(owns('partial', 'b')).toBe(false);
    expect(runIds.toSorted()).toEqual(['full', 'partial']);
  });

  it('reads a subject named twice from the newer of the two runs, and drops a run left owning nothing', () => {
    const { owns, runIds } = familyRunOwnership([
      run('oldest', 3, ['levers:a']),
      run('older', 2, ['levers:a', 'levers:b']),
      run('newer', 1, ['levers:a']),
    ], 'levers');

    expect(owns('newer', 'a')).toBe(true);
    expect(owns('older', 'a')).toBe(false);
    expect(owns('older', 'b')).toBe(true);
    expect(runIds.toSorted()).toEqual(['newer', 'older']);
  });

  it('reads the CVE what-ifs from the newest run that computed them, never from a price run after it', () => {
    const { owns, runIds } = familyRunOwnership([
      run('price', 1, []),
      run('full', 2, ['techniques', 'cves', 'levers', 'plans']),
      run('older-full', 3, ['techniques', 'cves', 'levers', 'plans']),
    ], 'cves');

    expect(owns('full', 'CVE-2024-0001')).toBe(true);
    expect(owns('price', 'CVE-2024-0001')).toBe(false);
    expect(owns('older-full', 'CVE-2024-0001')).toBe(false);
    expect(runIds).toEqual(['full']);
  });

  it('reads nothing from a run older than the newest whole-family run', () => {
    const { owns, runIds } = familyRunOwnership([
      run('named', 2, ['plans:p']),
      run('full', 1, ['techniques', 'levers', 'plans']),
    ], 'plans');

    expect(owns('full', 'p')).toBe(true);
    expect(owns('named', 'p')).toBe(false);
    expect(runIds).toEqual(['full']);
  });

  it('shares out each scenario on its own runs', () => {
    const { owns } = familyRunOwnership([
      run('full-1', 1, ['levers'], 'scenario-1'),
      run('partial-2', 1, ['levers:a'], 'scenario-2'),
      run('full-2', 2, ['levers'], 'scenario-2'),
    ], 'levers');

    expect(owns('full-1', 'a')).toBe(true);
    expect(owns('partial-2', 'a')).toBe(true);
    expect(owns('full-2', 'a')).toBe(false);
  });
});

describe('the crq-simulation payload', () => {
  it('reads a payload without a profile, or with one it cannot parse, as a full run', () => {
    expect(bookedRunProfile({ riskScenarioId: 's' })).toEqual(FULL_RUN_PROFILE);
    expect(bookedRunProfile({ riskScenarioId: 's', profile: { techniques: 'yes' } })).toEqual(FULL_RUN_PROFILE);
  });

  it('reads the profile of a payload queued before the CVE what-ifs existed as one asking for none', () => {
    expect(bookedRunProfile({ riskScenarioId: 's', profile: { techniques: true, levers: 'all', plans: 'all' } }))
      .toEqual({ techniques: true, cves: false, levers: 'all', plans: 'all' });
    expect(bookedRunProfile({ riskScenarioId: 's', profile: { techniques: false, cves: true, levers: [], plans: [] } }))
      .toEqual({ techniques: false, cves: true, levers: [], plans: [] });
  });

  it('folds an ask into the held payload as the run computing both, keeping who booked it', () => {
    expect(foldCrqSimulationPayload(
      { riskScenarioId: 's', userId: 'u', profile: { techniques: false, cves: false, levers: ['b'], plans: [] } },
      { riskScenarioId: 's', profile: { techniques: false, cves: true, levers: [], plans: ['p'] } },
    )).toEqual({ riskScenarioId: 's', userId: 'u', profile: { techniques: false, cves: true, levers: ['b'], plans: ['p'] } });
  });

  it('reads a booking naming a person or a service account, or marked requested, as asked for', () => {
    expect(isRequestedCrqSimulation({ riskScenarioId: 's', userId: 'u' })).toBe(true);
    expect(isRequestedCrqSimulation({ riskScenarioId: 's', serviceAccountId: 'a' })).toBe(true);
    expect(isRequestedCrqSimulation({ riskScenarioId: 's', requested: true })).toBe(true);
    expect(isRequestedCrqSimulation({ riskScenarioId: 's' })).toBe(false);
  });

  it('keeps a request folding into an event booking asked for, and leaves two event asks unmarked', () => {
    expect(isRequestedCrqSimulation(foldCrqSimulationPayload({ riskScenarioId: 's' }, { riskScenarioId: 's', userId: 'u' }))).toBe(true);
    expect(foldCrqSimulationPayload({ riskScenarioId: 's' }, { riskScenarioId: 's' })).not.toHaveProperty('requested');
    expect(foldCrqSimulationPayload({ riskScenarioId: 's', userId: 'u' }, { riskScenarioId: 's' })).not.toHaveProperty('requested');
  });
});

describe('runProfileCovers', () => {
  it('covers a booking every family of which the run computed, whole or by subject', () => {
    const full = runProfileTokens(FULL_RUN_PROFILE);
    expect(runProfileCovers(full, FULL_RUN_PROFILE)).toBe(true);
    expect(runProfileCovers(full, { ...PRICE_RUN_PROFILE, levers: ['c'] })).toBe(true);
    expect(runProfileCovers(['levers:c', 'levers:d'], { ...PRICE_RUN_PROFILE, levers: ['d', 'c'] })).toBe(true);
    expect(runProfileCovers([], PRICE_RUN_PROFILE)).toBe(true);
  });

  it('does not cover a booking asking for a family or a subject the run left out', () => {
    expect(runProfileCovers([], FULL_RUN_PROFILE)).toBe(false);
    expect(runProfileCovers(['levers:c'], { ...PRICE_RUN_PROFILE, levers: 'all' })).toBe(false);
    expect(runProfileCovers(['levers:c'], { ...PRICE_RUN_PROFILE, levers: ['d'] })).toBe(false);
    expect(runProfileCovers(['techniques', 'levers', 'plans'], FULL_RUN_PROFILE)).toBe(false);
  });
});
