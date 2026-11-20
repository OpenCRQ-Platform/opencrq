import { describe, expect, it } from 'vitest';
import type { CapabilityFunction, EffectiveEdgeState } from '../controls/capability/constants';
import type { EffectiveEdge } from '../controls/capability/effective-coverage';
import type { ControlValidation, ValidationCell } from './engine';
import type { EvidenceTimelineRow, ProvenPostureCounts } from './proven-posture-history';
import { deriveControlValidation } from './engine';
import {
  countCredited,
  countProvenPosture,
  evidenceAsOf,
  linesOwed,
  provenPostureKey,
  replayDays,
} from './proven-posture-history';

const CAP_EDR = 'capability-edr';
const CAP_NDR = 'capability-ndr';
const T1078 = 'technique-t1078';
const T1003 = 'technique-t1003';

const NOW = new Date('2026-08-19T12:00:00Z');
const DAY_MS = 86_400_000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);

const edge = (
  capabilityId: string,
  techniqueId: string,
  fn: CapabilityFunction = 'prevent',
  state: EffectiveEdgeState = 'recommended',
): EffectiveEdge => ({
  capabilityId,
  techniqueId,
  function: fn,
  source: state === 'added' ? 'tenant' : 'catalogue',
  state,
});

const cell = (techniqueId: string, fn: CapabilityFunction, validatedVotes: number, totalVotes: number): ValidationCell => ({
  techniqueId,
  techniqueExternalId: techniqueId,
  function: fn,
  state: validatedVotes === totalVotes ? 'validated' : 'contradicted',
  validatedVotes,
  totalVotes,
  latestProofAt: null,
});

const control = (capabilityId: string, cells: Array<ValidationCell>): ControlValidation => ({
  capabilityId,
  state: 'validated',
  summary: { validatedTechniques: 0, contradictedTechniques: 0, testedTechniques: 0, latestProofAt: null },
  cells,
});

const timelineRow = (overrides: Partial<EvidenceTimelineRow> = {}): EvidenceTimelineRow => ({
  supportingAssetId: 'asset-1',
  mitreTechniqueId: T1078,
  parentTechniqueId: null,
  expectationType: 'prevention',
  securityPlatformType: 'EDR',
  sourceScenarioId: 'scenario-1',
  sourceSimulationId: 'simulation-1',
  evaluatedAt: daysAgo(10),
  verdicts: [{ id: 'history-1', state: 'dismissed', observedAt: daysAgo(10), recordedAt: daysAgo(10) }],
  ...overrides,
});

describe('countCredited', () => {
  it('counts catalogue and added techniques per control and function', () => {
    const credited = countCredited([
      edge(CAP_EDR, T1078),
      edge(CAP_EDR, T1003, 'prevent', 'added'),
      edge(CAP_EDR, T1078, 'detect'),
    ]);

    expect(credited.get(provenPostureKey(CAP_EDR, 'prevent'))).toBe(2);
    expect(credited.get(provenPostureKey(CAP_EDR, 'detect'))).toBe(1);
  });

  it('leaves out the techniques the tenant removed', () => {
    const credited = countCredited([edge(CAP_EDR, T1078), edge(CAP_EDR, T1003, 'prevent', 'removed')]);

    expect(credited.get(provenPostureKey(CAP_EDR, 'prevent'))).toBe(1);
  });
});

describe('countProvenPosture', () => {
  const credited = new Map([
    [provenPostureKey(CAP_EDR, 'prevent'), 3],
    [provenPostureKey(CAP_NDR, 'detect'), 2],
  ]);

  it('holds a cell above three successes in four, never at exactly three', () => {
    const counts = countProvenPosture(
      [control(CAP_EDR, [cell(T1078, 'prevent', 3, 4), cell(T1003, 'prevent', 4, 5)])],
      credited,
      new Set([CAP_EDR]),
    );

    expect(counts).toEqual([{ capabilityId: CAP_EDR, function: 'prevent', credited: 3, tested: 2, held: 1 }]);
  });

  it('counts a reachable control the derivation never reached as tested 0', () => {
    const counts = countProvenPosture([], credited, new Set([CAP_NDR]));

    expect(counts).toEqual([{ capabilityId: CAP_NDR, function: 'detect', credited: 2, tested: 0, held: 0 }]);
  });

  it('gives a function crediting nothing no entry', () => {
    const counts = countProvenPosture([control(CAP_EDR, [cell(T1078, 'prevent', 1, 1)])], credited, new Set([CAP_EDR]));

    expect(counts.map((entry) => entry.function)).toEqual(['prevent']);
  });

  it('records nothing for a control out of reach', () => {
    expect(countProvenPosture([control(CAP_EDR, [cell(T1078, 'prevent', 1, 1)])], credited, new Set())).toEqual([]);
  });
});

describe('linesOwed', () => {
  const counts: Array<ProvenPostureCounts> = [{ capabilityId: CAP_EDR, function: 'prevent', credited: 3, tested: 2, held: 1 }];
  const key = provenPostureKey(CAP_EDR, 'prevent');

  it('owes a line to a key that has none', () => {
    expect(linesOwed(counts, new Map())).toEqual(counts);
  });

  it('owes nothing when the triple did not move', () => {
    expect(linesOwed(counts, new Map([[key, counts[0]]]))).toEqual([]);
  });

  it.each([
    ['credited', { credited: 4, tested: 2, held: 1 }],
    ['tested', { credited: 3, tested: 1, held: 1 }],
    ['held', { credited: 3, tested: 2, held: 2 }],
  ])('owes a line when %s moved', (_, last) => {
    expect(linesOwed(counts, new Map([[key, { ...counts[0], ...last }]]))).toEqual(counts);
  });

  it('owes a zero line to a key the counts no longer carry', () => {
    const withdrawn: ProvenPostureCounts = { capabilityId: CAP_NDR, function: 'detect', credited: 2, tested: 1, held: 1 };

    expect(linesOwed(counts, new Map([[key, counts[0]], [provenPostureKey(CAP_NDR, 'detect'), withdrawn]]))).toEqual([
      { capabilityId: CAP_NDR, function: 'detect', credited: 0, tested: 0, held: 0 },
    ]);
  });

  it('owes nothing to a key already closed by a zero line', () => {
    const closed: ProvenPostureCounts = { capabilityId: CAP_NDR, function: 'detect', credited: 0, tested: 0, held: 0 };

    expect(linesOwed([], new Map([[provenPostureKey(CAP_NDR, 'detect'), closed]]))).toEqual([]);
  });
});

describe('evidenceAsOf', () => {
  it('leaves out a row before its first verdict', () => {
    expect(evidenceAsOf([timelineRow()], daysAgo(11))).toEqual([]);
  });

  it('reads the verdict in force between two verdicts', () => {
    const row = timelineRow({
      evaluatedAt: daysAgo(2),
      verdicts: [
        { id: 'history-1', state: 'dismissed', observedAt: daysAgo(10), recordedAt: daysAgo(10) },
        { id: 'history-2', state: 'applicable', observedAt: daysAgo(2), recordedAt: daysAgo(2) },
      ],
    });

    expect(evidenceAsOf([row], daysAgo(5))[0]).toMatchObject({ runVerdict: 'dismissed', runAt: daysAgo(10) });
    expect(evidenceAsOf([row], daysAgo(1))[0]).toMatchObject({ runVerdict: 'applicable', runAt: daysAgo(2) });
  });

  it('reads a late verdict from the day it was delivered, dated by its test', () => {
    const row = timelineRow({
      evaluatedAt: daysAgo(2),
      verdicts: [
        { id: 'history-1', state: 'dismissed', observedAt: daysAgo(10), recordedAt: daysAgo(10) },
        { id: 'history-2', state: 'applicable', observedAt: daysAgo(8), recordedAt: daysAgo(2) },
      ],
    });

    expect(evidenceAsOf([row], daysAgo(5))[0]).toMatchObject({ runVerdict: 'dismissed', runAt: daysAgo(10) });
    expect(evidenceAsOf([row], daysAgo(1))[0]).toMatchObject({ runVerdict: 'applicable', runAt: daysAgo(8) });
  });

  it('keeps an evaluation already made and clips a later one to the instant', () => {
    const row = timelineRow({ evaluatedAt: daysAgo(3) });

    expect(evidenceAsOf([row], daysAgo(1))[0]?.evaluatedAt).toEqual(daysAgo(3));
    expect(evidenceAsOf([row], daysAgo(5))[0]?.evaluatedAt).toEqual(daysAgo(5));
  });

  it('lets a result unreplayed for longer than the validity window expire', () => {
    const row = timelineRow({ evaluatedAt: daysAgo(60), verdicts: [{ id: 'history-1', state: 'dismissed', observedAt: daysAgo(60), recordedAt: daysAgo(60) }] });
    const derive = (at: Date) => deriveControlValidation(
      {
        rows: evidenceAsOf([row], at),
        edges: [edge(CAP_EDR, T1078)],
        platformControls: [{ platformTypeKey: 'EDR', capabilityId: CAP_EDR }],
        techniqueExternalIds: new Map(),
      },
      { policy: { measuredValidityDays: 30 }, now: at },
    );

    expect(derive(daysAgo(40))).toHaveLength(1);
    expect(derive(daysAgo(20))).toEqual([]);
  });
});

describe('replayDays', () => {
  it('starts on the midnight after the first verdict and stops before now', () => {
    const days = replayDays(new Date('2026-08-16T08:00:00Z'), NOW);

    expect(days).toEqual([
      new Date('2026-08-17T00:00:00Z'),
      new Date('2026-08-18T00:00:00Z'),
      new Date('2026-08-19T00:00:00Z'),
    ]);
  });

  it('goes back no further than the retention', () => {
    const days = replayDays(daysAgo(400), NOW);

    expect(days).toHaveLength(365);
    expect(days[0].getTime()).toBeGreaterThanOrEqual(daysAgo(365).getTime());
  });

  it('replays nothing for a first verdict today, or none at all', () => {
    expect(replayDays(new Date('2026-08-19T01:00:00Z'), NOW)).toEqual([]);
    expect(replayDays(null, NOW)).toEqual([]);
  });
});
