import { describe, expect, it } from 'vitest';
import type { CategoryResolverInput, ComparedRun, ComparedRunRow, WindowRun } from '../types';
import { TEF_EVERY_SIZE } from '../../tef-catalog/catalogue-constants';
import { roundFigure, valuesDiffer } from '../change-values';
import { criticalAssetsCategory } from './asset-posture';
import { attackFrequencyCategory } from './attack-frequency';
import { controlsCategory } from './controls';
import { criticalFindingsCategory } from './findings';
import { modelCategory } from './model';
import { magnitudeOf, runResultsCategory, susceptibilityOf, tefOf } from './run-results';
import { techniqueCoverageCategory } from './technique-coverage';

const baseRun: ComparedRunRow = {
  id: 'run',
  riskScenarioId: 'scenario',
  jobId: null,
  readAt: null,
  inputsFingerprint: null,
  createdAt: new Date('2026-10-01T10:00:00Z'),
  iterations: 10_000,
  vulnerabilityP5: 0.1,
  vulnerabilityP50: 0.2,
  vulnerabilityP95: 0.3,
  vulnerabilityMean: 0.2,
  tefMin: 1,
  tefLikely: 4,
  tefMax: 7,
  lefMean: 1,
  lefP10: 0.5,
  lefP90: 2,
  aleMean: 1_000_000,
  aleP10: 500_000,
  aleP90: 2_000_000,
  magnitudeMean: 2_000_000,
  magnitudeP10: 1_000_000,
  magnitudeP90: 4_000_000,
  techniqueCount: 40,
  coveredTechniqueCount: 30,
  threatEvidenceMode: null,
  admittedActorCount: null,
  outcomeBlocked: 0.4,
  outcomeEvicted: 0.3,
  outcomeImpactDetected: 0.2,
  outcomeImpactUndetected: 0.1,
  pathShareStoppedAtInitialAccess: null,
  pathShareDirect: null,
  pathShareLong: null,
  pathShareWithoutInitialAccess: null,
  noTarget: null,
  calibrationVintage: '2026.09',
  cornerConstants: ['a', 'b'],
  catalogueVintage: 'attack-enterprise-17',
  unscannedAssetShare: 0,
  unscannedAssetCount: 0,
  estateAssetCount: 120,
  declaredAssetCount: null,
  declaredAssetShare: null,
  estateMode: 'open',
  boostApplied: 1,
  uncontestedPairCount: 0,
  uncontestablePairCount: 0,
  aleAtMemorylessDetection: null,
  profile: ['techniques', 'levers', 'plans'],
  groupScores: [
    { actorClass: 'ransomware_operator', share: 0.41 },
    { actorClass: 'state_sponsored', share: 0.22 },
  ],
};

const compared = (overrides: Partial<ComparedRunRow>, readAt: string): ComparedRun => ({
  run: { ...baseRun, ...overrides },
  readAt: new Date(readAt),
});

const unreachable = (): never => {
  throw new Error('these categories read the two runs alone');
};

const windowRun = ({ run }: ComparedRun): WindowRun => ({
  id: run.id,
  createdAt: run.createdAt,
  readAt: run.readAt,
  uncontestedPairCount: run.uncontestedPairCount,
  uncontestablePairCount: run.uncontestablePairCount,
});

const between = (
  earlier: ComparedRun,
  later: ComparedRun,
  repo: Partial<CategoryResolverInput['repo']> = {},
  inner: ReadonlyArray<WindowRun> = [],
): CategoryResolverInput => ({
  riskScenarioId: 'scenario',
  before: earlier,
  after: later,
  window: [windowRun(earlier), ...inner, windowRun(later)],
  uniqueScoreHistoryStart: new Date('2026-07-01T00:00:00Z'),
  repo: {
    findScenarioRuns: unreachable,
    findScenarioRunCurve: unreachable,
    findScenarioRunsBetween: unreachable,
    findGroupSharesByRunIds: unreachable,
    findReachGapsByRunIds: unreachable,
    findScenarioScope: unreachable,
    findControlLeversByRunIds: unreachable,
    findControlAssessmentEvents: unreachable,
    findScenarioEstate: unreachable,
    findEstatePostureLines: unreachable,
    findUniqueFindingChanges: unreachable,
    findCvesNoLongerReported: unreachable,
    findRunTefTripletsByIds: unreachable,
    findTefEstimatesByScenarioId: unreachable,
    ...repo,
  },
});

const before = compared({ id: 'before' }, '2026-10-01T09:00:00Z');

describe('a currency change', () => {
  it('counts only once the two amounts print differently', () => {
    expect(valuesDiffer('currency', 2_000_000, 2_020_000)).toBe(false);
    expect(valuesDiffer('currency', 2_000_000, 2_060_000)).toBe(true);
  });

  it('reads each amount in the unit it prints in, across the K, M, B and T thresholds', () => {
    expect(valuesDiffer('currency', 998_100, 998_400)).toBe(false);
    expect(valuesDiffer('currency', 999_400, 999_600)).toBe(true);
    expect(valuesDiffer('currency', 999_600, 1_040_000)).toBe(false);
    expect(valuesDiffer('currency', 1_000_000_000_000, 1_010_000_000_000)).toBe(false);
    expect(valuesDiffer('currency', 1_000_000_000_000, 1_060_000_000_000)).toBe(true);
    expect(valuesDiffer('currency', 999_940_000, 999_960_000)).toBe(true);
    expect(valuesDiffer('currency', 999.4, 999.6)).toBe(true);
  });

  it('reads a negative amount the way it reads a positive one', () => {
    expect(valuesDiffer('currency', -2_000_000, -2_020_000)).toBe(false);
    expect(valuesDiffer('currency', -2_000_000, -2_060_000)).toBe(true);
    expect(valuesDiffer('currency', -999_400, -999_600)).toBe(true);
    expect(valuesDiffer('currency', -0.4, 0.3)).toBe(false);
    expect(valuesDiffer('currency', -2_000_000, 2_000_000)).toBe(true);
  });
});

describe('a frequency or share change', () => {
  it('rounds each figure as the page prints it, from its decimal form', () => {
    expect(valuesDiffer('frequency', 1.004, 1.005)).toBe(true);
    expect(valuesDiffer('frequency', 1.001, 1.004)).toBe(false);
    expect(valuesDiffer('share', 0.1234, 0.1236)).toBe(true);
    expect(valuesDiffer('share', 0.1231, 0.1234)).toBe(false);
    expect(valuesDiffer('share', 0.0185, 0.0181)).toBe(true);
  });
});

describe('a run figure on the wire', () => {
  it('keeps eight significant digits, so a figure on a print boundary reads alike wherever it is read', () => {
    expect(roundFigure(15_315_926.412962947)).toBe(15_315_926);
    expect(roundFigure(0.1072977502633401)).toBe(0.10729775);
    expect(roundFigure(3.1249999999999996)).toBe(3.125);
  });

  it('reads a TEF the same in the change list as in the run curve', async () => {
    const after = compared({ id: 'after', tefMax: 8 }, '2026-10-06T09:00:00Z');

    const events = await runResultsCategory.resolve(between(before, after));

    expect(tefOf(after.run)).toBe(4.1666667);
    expect(events).toEqual([expect.objectContaining({ values: { format: 'frequency', before: 4, after: 4.1666667 } })]);
  });

  it('reads a susceptibility the same in the change list as in the run curve', async () => {
    const after = compared({ id: 'after', outcomeEvicted: 0.3123456789 }, '2026-10-06T09:00:00Z');

    const events = await runResultsCategory.resolve(between(before, after));

    expect(susceptibilityOf(after.run)).toBe(0.29685185);
    expect(events).toContainEqual(expect.objectContaining({
      item: expect.objectContaining({ key: 'susceptibility' }),
      values: { format: 'share', before: 0.295, after: 0.29685185 },
    }));
  });

  it('reads a magnitude the same in the change list as in the run curve', async () => {
    const after = compared({ id: 'after', magnitudeMean: 3_345_678.912345 }, '2026-10-06T09:00:00Z');

    const events = await runResultsCategory.resolve(between(before, after));

    expect(magnitudeOf(after.run)).toBe(3_345_678.9);
    expect(events).toContainEqual(expect.objectContaining({
      item: expect.objectContaining({ key: 'magnitude' }),
      values: { format: 'currency', before: 2_000_000, after: 3_345_678.9 },
    }));
  });
});

describe('run results category', () => {
  it('lists nothing when the two runs computed alike', async () => {
    const after = compared({ id: 'after' }, '2026-10-06T09:00:00Z');

    expect(await runResultsCategory.resolve(between(before, after))).toEqual([]);
  });

  it('lists each actor class whose share moved, with its share before and after, as a balance of the two runs', async () => {
    const after = compared({
      id: 'after',
      groupScores: [
        { actorClass: 'ransomware_operator', share: 0.48 },
        { actorClass: 'state_sponsored', share: 0.18 },
      ],
    }, '2026-10-06T09:00:00Z');

    const events = await runResultsCategory.resolve(between(before, after));

    expect(events).toEqual([
      expect.objectContaining({
        category: 'run-results',
        moment: { kind: 'balance' },
        direction: 'up',
        item: { kind: 'actor-class-share', key: 'ransomware_operator', label: null, link: { kind: 'scenario-tab', tab: 'threat' } },
        values: { format: 'share', before: 0.41, after: 0.48 },
      }),
      expect.objectContaining({
        direction: 'down',
        item: expect.objectContaining({ key: 'state_sponsored' }),
        values: { format: 'share', before: 0.22, after: 0.18 },
      }),
    ]);
  });

  it('matches classes across runs whatever the rows, a class absent from a run reading as null', async () => {
    const after = compared({
      id: 'after',
      groupScores: [
        { actorClass: 'ransomware_operator', share: 0.2 },
        { actorClass: 'ransomware_operator', share: 0.21 },
        { actorClass: 'state_sponsored', share: 0.22 },
        { actorClass: 'hacktivist', share: 0.1 },
      ],
    }, '2026-10-06T09:00:00Z');

    const events = await runResultsCategory.resolve(between(before, after));

    expect(events.map((event) => [event.item.key, event.values?.before, event.values?.after])).toEqual([
      ['hacktivist', null, 0.1],
    ]);
  });

  it('reads the TEF as the PERT mean of the triplet and the susceptibility as the priced fraction', async () => {
    const after = compared({ id: 'after', tefLikely: 5.5, outcomeBlocked: 0.3, outcomeImpactUndetected: 0.2 }, '2026-10-06T09:00:00Z');

    const events = await runResultsCategory.resolve(between(before, after));
    const byKey = new Map(events.map((event) => [event.item.key, event]));

    expect(byKey.get('tef')?.values).toEqual({ format: 'frequency', before: 4, after: 5 });
    expect(byKey.get('tef')?.direction).toBe('up');
    expect(byKey.get('susceptibility')?.direction).toBe('up');
    expect(byKey.get('outcome-blocked')?.direction).toBe('up');
    expect(byKey.get('outcome-impact-undetected')?.direction).toBe('up');
  });

  it('ignores a Monte Carlo wobble below the printed precision', async () => {
    const after = compared({ id: 'after', magnitudeMean: 2_004_000, outcomeImpactDetected: 0.2002, outcomeBlocked: 0.3998 }, '2026-10-06T09:00:00Z');

    expect(await runResultsCategory.resolve(between(before, after))).toEqual([]);
  });

  it('reads more covered techniques as lowering the loss', async () => {
    const after = compared({ id: 'after', coveredTechniqueCount: 32 }, '2026-10-06T09:00:00Z');

    const [event] = await runResultsCategory.resolve(between(before, after));

    expect(event.item.key).toBe('covered-technique-count');
    expect(event.direction).toBe('down');
  });
});

describe('model category', () => {
  it('lists a catalogue vintage change with its value before and after, moving no risk', async () => {
    const after = compared({ id: 'after', catalogueVintage: 'attack-enterprise-18' }, '2026-10-06T09:00:00Z');

    expect(await modelCategory.resolve(between(before, after))).toEqual([{
      category: 'model',
      moment: { kind: 'balance' },
      direction: 'none',
      item: { kind: 'model-setting', key: 'catalogue-vintage', label: null, link: { kind: 'scenario-tab', tab: 'crq' } },
      sentence: { key: 'value-changed', parts: {} },
      values: { format: 'text', before: 'attack-enterprise-17', after: 'attack-enterprise-18' },
    }]);
  });

  it('reads the same corner constants in another order as no change', async () => {
    const after = compared({ id: 'after', cornerConstants: ['b', 'a'] }, '2026-10-06T09:00:00Z');

    expect(await modelCategory.resolve(between(before, after))).toEqual([]);
  });

  it('lists the iterations and the estate mode', async () => {
    const after = compared({ id: 'after', iterations: 20_000, estateMode: 'closed' }, '2026-10-06T09:00:00Z');

    const events = await modelCategory.resolve(between(before, after));

    expect(events.map((event) => event.item.key)).toEqual(['iterations', 'estate-mode']);
  });
});

type ReachGapRow = Awaited<ReturnType<CategoryResolverInput['repo']['findReachGapsByRunIds']>>[number];

const gap = (runId: string, externalId: string, family: ReachGapRow['family'], kind: ReachGapRow['gap'] = 'estate'): ReachGapRow =>
  ({ runId, gap: kind, family, externalId, name: `${externalId} name` });

const innerRun = (id: string, stored = true): WindowRun => ({
  id,
  createdAt: new Date('2026-10-03T10:00:00Z'),
  readAt: null,
  uncontestedPairCount: stored ? 0 : null,
  uncontestablePairCount: stored ? 0 : null,
});

describe('technique coverage category', () => {
  const after = compared({ id: 'after' }, '2026-10-06T09:00:00Z');
  const readGaps = (rows: Array<ReachGapRow>) => ({
    findReachGapsByRunIds: (runIds: ReadonlyArray<string>) => Promise.resolve(rows.filter((row) => runIds.includes(row.runId))),
  });
  const withGaps = (rows: Array<ReachGapRow>, inner: ReadonlyArray<WindowRun> = []) => between(before, after, readGaps(rows), inner);

  it('lists a pair that is a gap of the later run only as no longer contested, on the later run, opening the technique', async () => {
    const events = await techniqueCoverageCategory.resolve(withGaps([gap('after', 'T1190', 'web_application')]));

    expect(events).toEqual([{
      category: 'technique-coverage',
      moment: { kind: 'run', runId: 'after' },
      direction: 'up',
      item: { kind: 'technique-family', key: 'T1190/web_application', label: 'T1190 name', link: { kind: 'technique', externalId: 'T1190' } },
      sentence: { key: 'uncontested-by-estate', parts: { technique: 'T1190', family: 'web_application' } },
      values: null,
    }]);
  });

  it('reads a catalogue gap with its own sentence', async () => {
    const [event] = await techniqueCoverageCategory.resolve(withGaps([gap('after', 'T1190', 'web_application', 'catalogue')]));

    expect(event.sentence.key).toBe('uncontestable-by-catalogue');
  });

  it('lists a pair that is a gap of the earlier run only as now contested, each gap with its sentence', async () => {
    const events = await techniqueCoverageCategory.resolve(withGaps([
      gap('before', 'T1078', 'identity'),
      gap('before', 'T1566', 'host', 'catalogue'),
    ]));

    expect(events.map((event) => [event.item.key, event.direction, event.sentence.key])).toEqual([
      ['T1078/identity', 'down', 'contested-by-estate'],
      ['T1566/host', 'down', 'contestable-by-catalogue'],
    ]);
  });

  it('lists nothing for a pair that is a gap of both runs, even of another kind', async () => {
    const events = await techniqueCoverageCategory.resolve(withGaps([
      gap('before', 'T1190', 'web_application'),
      gap('after', 'T1190', 'web_application', 'catalogue'),
      gap('after', 'T1190', 'host'),
    ]));

    expect(events.map((event) => event.item.key)).toEqual(['T1190/host']);
  });

  it('hangs a pair on the earliest run from which it kept the state the later run has', async () => {
    const events = await techniqueCoverageCategory.resolve(withGaps([
      gap('second', 'T1213', 'web_application'),
      gap('third', 'T1213', 'web_application'),
      gap('after', 'T1213', 'web_application'),
      gap('before', 'T1078', 'identity'),
      gap('first', 'T1078', 'identity'),
      gap('second', 'T1078', 'identity'),
    ], [innerRun('first'), innerRun('second'), innerRun('third')]));

    expect(events.map((event) => [event.item.key, event.moment])).toEqual([
      ['T1213/web_application', { kind: 'run', runId: 'second' }],
      ['T1078/identity', { kind: 'run', runId: 'third' }],
    ]);
  });

  it('walks back past a pair that left and came back, to where it last took its final state', async () => {
    const events = await techniqueCoverageCategory.resolve(withGaps([
      gap('first', 'T1213', 'web_application'),
      gap('third', 'T1213', 'web_application'),
      gap('after', 'T1213', 'web_application'),
    ], [innerRun('first'), innerRun('second'), innerRun('third')]));

    expect(events.map((event) => event.moment)).toEqual([{ kind: 'run', runId: 'third' }]);
  });

  it('hangs a pair on the run where it took the gap kind its sentence names', async () => {
    const events = await techniqueCoverageCategory.resolve(withGaps([
      gap('first', 'T1490', 'container_workload'),
      gap('after', 'T1490', 'container_workload', 'catalogue'),
    ], [innerRun('first')]));

    expect(events.map((event) => [event.sentence.key, event.moment])).toEqual([
      ['uncontestable-by-catalogue', { kind: 'run', runId: 'after' }],
    ]);
  });

  it('lists nothing for a pair that entered then left the gaps inside the window', async () => {
    const events = await techniqueCoverageCategory.resolve(withGaps([gap('first', 'T1213', 'web_application')], [innerRun('first')]));

    expect(events).toEqual([]);
  });

  it('skips a run inside the window that stores no gap', async () => {
    const events = await techniqueCoverageCategory.resolve(withGaps(
      [gap('third', 'T1213', 'web_application'), gap('after', 'T1213', 'web_application')],
      [innerRun('second'), innerRun('third', false)],
    ));

    expect(events.map((event) => event.moment)).toEqual([{ kind: 'run', runId: 'after' }]);
  });

  it('lists nothing when an end stores no gap, rather than reading every gap of the other as new', async () => {
    const unstored = compared({ id: 'before', uncontestedPairCount: null, uncontestablePairCount: null }, '2026-10-01T09:00:00Z');

    const events = await techniqueCoverageCategory.resolve(between(unstored, after, readGaps([gap('after', 'T1213', 'web_application')])));

    expect(events).toEqual([]);
  });
});

type LeverRow = Awaited<ReturnType<CategoryResolverInput['repo']['findControlLeversByRunIds']>>[number];
type AssessmentEventRow = Awaited<ReturnType<CategoryResolverInput['repo']['findControlAssessmentEvents']>>[number];

const lever = (runId: string, currentStrength: LeverRow['currentStrength'], currentCoverage: LeverRow['currentCoverage'], controlId = 'edr'): LeverRow => ({
  runId,
  controlId,
  name: controlId === 'edr' ? 'Endpoint Detection and Response' : 'Offline backups',
  currentStrength,
  currentCoverage,
});

const assessment = (
  createdAt: string,
  newStrength: AssessmentEventRow['newStrength'],
  newCoverage: AssessmentEventRow['newCoverage'],
  { controlId = 'edr', organizationId = null }: {
    controlId?: string,
    organizationId?: string | null,
  } = {},
): AssessmentEventRow => ({
  id: createdAt,
  controlId,
  organizationId,
  newStrength,
  newCoverage,
  createdAt: new Date(createdAt),
});

describe('controls category', () => {
  const after = compared({ id: 'after' }, '2026-10-06T09:00:00Z');
  const withPosture = (levers: Array<LeverRow>, events: Array<AssessmentEventRow> = []) => between(before, after, {
    findScenarioScope: () => Promise.resolve({ organizationId: 'production', name: 'Production IS' }),
    findControlLeversByRunIds: (runIds) => Promise.resolve(levers.filter((row) => runIds.includes(row.runId))),
    findControlAssessmentEvents: (controlIds, organizationId, until) => Promise.resolve(events.filter((event) =>
      controlIds.includes(event.controlId)
      && (event.organizationId === null || event.organizationId === organizationId)
      && event.createdAt <= until)),
  });

  it('lists a lever whose strength went from Master to Intermediate as one row raising the loss, dated on its event, opening the control', async () => {
    const events = await controlsCategory.resolve(withPosture(
      [lever('before', 'L3', 'L2'), lever('after', 'L2', 'L2')],
      [assessment('2026-09-01T00:00:00Z', 'L3', 'L2'), assessment('2026-10-03T14:00:00Z', 'L2', 'L2')],
    ));

    expect(events).toEqual([{
      category: 'controls',
      moment: { kind: 'recorded', at: '2026-10-03T14:00:00.000Z' },
      direction: 'up',
      item: { kind: 'control', key: 'edr/strength', label: 'Endpoint Detection and Response', link: { kind: 'control', controlId: 'edr' } },
      sentence: { key: 'strength-changed', parts: { control: 'Endpoint Detection and Response', from: 'L3', to: 'L2' } },
      values: null,
    }]);
  });

  it('names the risk scope when the change was declared on it', async () => {
    const [event] = await controlsCategory.resolve(withPosture(
      [lever('before', 'L3', 'L2'), lever('after', 'L2', 'L2')],
      [assessment('2026-09-01T00:00:00Z', 'L3', 'L2'), assessment('2026-10-03T14:00:00Z', 'L2', null, { organizationId: 'production' })],
    ));

    expect(event.sentence).toEqual({
      key: 'strength-changed-on-scope',
      parts: { control: 'Endpoint Detection and Response', from: 'L3', to: 'L2', scope: 'Production IS' },
    });
  });

  it('reads a widened coverage as lowering the loss', async () => {
    const events = await controlsCategory.resolve(withPosture(
      [lever('before', 'L2', 'L1'), lever('after', 'L2', 'L2')],
      [assessment('2026-09-01T00:00:00Z', 'L2', 'L1'), assessment('2026-10-02T08:00:00Z', 'L2', 'L2')],
    ));

    expect(events.map((event) => [event.item.key, event.direction, event.sentence.parts.from, event.sentence.parts.to])).toEqual([
      ['edr/coverage', 'down', 'L1', 'L2'],
    ]);
  });

  it('lists each axis that moved as its own row', async () => {
    const events = await controlsCategory.resolve(withPosture([lever('before', 'L3', 'L2'), lever('after', 'L2', 'L3')]));

    expect(events.map((event) => [event.item.key, event.direction])).toEqual([['edr/strength', 'up'], ['edr/coverage', 'down']]);
  });

  it('hangs a difference no event explains on the later run', async () => {
    const events = await controlsCategory.resolve(withPosture([lever('before', 'L3', 'L2'), lever('after', 'L2', 'L2')]));

    expect(events.map((event) => event.moment)).toEqual([{ kind: 'run', runId: 'after' }]);
  });

  it('lists nothing for a control neither run treated as a lever, even when its strength changed', async () => {
    const events = await controlsCategory.resolve(withPosture(
      [lever('before', 'L2', 'L2'), lever('after', 'L2', 'L2')],
      [assessment('2026-09-01T00:00:00Z', 'L3', 'L3', { controlId: 'backups' }), assessment('2026-10-03T00:00:00Z', 'L1', 'L3', { controlId: 'backups' })],
    ));

    expect(events).toEqual([]);
  });

  it('lists nothing for a change made after the later run read its inputs', async () => {
    const events = await controlsCategory.resolve(withPosture(
      [lever('before', 'L3', 'L2')],
      [assessment('2026-09-01T00:00:00Z', 'L3', 'L2'), assessment('2026-10-06T10:00:00Z', 'L2', 'L2')],
    ));

    expect(events).toEqual([]);
  });

  it('takes the before value of a lever of the later run only from its events at the earlier reading time', async () => {
    const events = await controlsCategory.resolve(withPosture(
      [lever('after', 'L2', 'L1', 'backups')],
      [
        assessment('2026-09-01T00:00:00Z', 'L3', 'L2', { controlId: 'backups' }),
        assessment('2026-10-04T00:00:00Z', 'L2', 'L2', { controlId: 'backups' }),
        assessment('2026-10-05T00:00:00Z', null, 'L1', { controlId: 'backups', organizationId: 'production' }),
      ],
    ));

    expect(events.map((event) => [event.sentence.key, event.sentence.parts.from, event.sentence.parts.to, event.moment])).toEqual([
      ['strength-changed', 'L3', 'L2', { kind: 'recorded', at: '2026-10-04T00:00:00.000Z' }],
      ['coverage-changed-on-scope', 'L2', 'L1', { kind: 'recorded', at: '2026-10-05T00:00:00.000Z' }],
    ]);
  });

  it('lists nothing for a lever of one run only whose journal is empty, its other posture having no past', async () => {
    const events = await controlsCategory.resolve(withPosture([lever('after', 'L2', 'L2')]));

    expect(events).toEqual([]);
  });
});

type PostureLineRow = Awaited<ReturnType<CategoryResolverInput['repo']['findEstatePostureLines']>>[number];

const postureLine = (supportingAssetId: string, changedAt: string, score: number | null): PostureLineRow =>
  ({ supportingAssetId, name: supportingAssetId, derivedName: null, score, changedAt: new Date(changedAt) });

describe('asset posture categories', () => {
  const after = compared({ id: 'after' }, '2026-10-06T09:00:00Z');
  const withPostures = (rows: Array<PostureLineRow>) => between(before, after, {
    findScenarioEstate: () => Promise.resolve({ mode: 'open' }),
    findEstatePostureLines: () => Promise.resolve(rows),
  });

  it('lists an asset moving from Medium to Critical under Critical assets, raising the loss, dated on its line, opening the asset', async () => {
    const events = await criticalAssetsCategory.resolve(withPostures([
      postureLine('fw-edge-01', '2026-09-20T00:00:00Z', 60),
      postureLine('fw-edge-01', '2026-10-03T14:00:00Z', 12),
    ]));

    expect(events).toEqual([{
      category: 'assets-critical',
      moment: { kind: 'recorded', at: '2026-10-03T14:00:00.000Z' },
      direction: 'up',
      item: { kind: 'asset', key: 'fw-edge-01', label: 'fw-edge-01', link: { kind: 'asset', supportingAssetId: 'fw-edge-01' } },
      sentence: { key: 'posture-band-moved', parts: { from: 'medium', to: 'critical' } },
      values: null,
    }]);
  });

  it('counts an asset leaving High for Medium under High assets, lowering the loss', async () => {
    const [event] = await criticalAssetsCategory.resolve(withPostures([
      postureLine('mft-01', '2026-09-20T00:00:00Z', 40),
      postureLine('mft-01', '2026-10-02T00:00:00Z', 55),
    ]));

    expect([event.category, event.direction, event.sentence]).toEqual(['assets-high', 'down', { key: 'posture-band-moved', parts: { from: 'high', to: 'medium' } }]);
  });

  it('lists nothing for a score moving inside its band, nor for an asset leaving its band then coming back', async () => {
    const events = await criticalAssetsCategory.resolve(withPostures([
      postureLine('srv-01', '2026-09-20T00:00:00Z', 30),
      postureLine('srv-01', '2026-10-02T00:00:00Z', 45),
      postureLine('srv-02', '2026-09-20T00:00:00Z', 30),
      postureLine('srv-02', '2026-10-02T00:00:00Z', 10),
      postureLine('srv-02', '2026-10-04T00:00:00Z', 35),
    ]));

    expect(events).toEqual([]);
  });

  it('lists an asset that lost its posture as going from its band to none, lowering the loss', async () => {
    const [event] = await criticalAssetsCategory.resolve(withPostures([
      postureLine('mft-01', '2026-09-20T00:00:00Z', 60),
      postureLine('mft-01', '2026-10-02T00:00:00Z', null),
    ]));

    expect([event.category, event.direction, event.sentence]).toEqual(['assets-other', 'down', { key: 'posture-band-moved', parts: { from: 'medium', to: 'none' } }]);
  });

  it('lists an asset first measured inside the window as first seen under Other assets, moving neither way', async () => {
    const events = await criticalAssetsCategory.resolve(withPostures([postureLine('new-01', '2026-10-02T00:00:00Z', 30)]));

    expect(events).toEqual([{
      category: 'assets-other',
      moment: { kind: 'recorded', at: '2026-10-02T00:00:00.000Z' },
      direction: 'none',
      item: { kind: 'asset', key: 'new-01', label: 'new-01', link: { kind: 'asset', supportingAssetId: 'new-01' } },
      sentence: { key: 'posture-first-seen', parts: { band: 'high' } },
      values: null,
    }]);
  });

  it('compares an asset first measured inside the window from its first line, so an earlier run older than the history still lists its band moves', async () => {
    const events = await criticalAssetsCategory.resolve(withPostures([
      postureLine('metabase', '2026-10-02T10:00:00Z', 32),
      postureLine('metabase', '2026-10-02T22:00:00Z', 66),
      postureLine('metabase', '2026-10-04T13:00:00Z', 14),
      postureLine('metabase', '2026-10-05T13:00:00Z', 4),
    ]));

    expect(events.map((event) => [event.category, event.direction, event.moment, event.sentence])).toEqual([
      ['assets-other', 'none', { kind: 'recorded', at: '2026-10-02T10:00:00.000Z' }, { key: 'posture-first-seen', parts: { band: 'critical' } }],
      ['assets-critical', 'up', { kind: 'recorded', at: '2026-10-04T13:00:00.000Z' }, { key: 'posture-band-moved', parts: { from: 'high', to: 'critical' } }],
    ]);
  });

  it('lists an asset first measured then moving inside Other assets once, as first seen at the band it holds at the later run, on its first line', async () => {
    const events = await criticalAssetsCategory.resolve(withPostures([
      postureLine('new-01', '2026-10-02T00:00:00Z', 60),
      postureLine('new-01', '2026-10-04T00:00:00Z', 90),
    ]));

    expect(events.map((event) => [event.category, event.moment, event.sentence])).toEqual([
      ['assets-other', { kind: 'recorded', at: '2026-10-02T00:00:00.000Z' }, { key: 'posture-first-seen', parts: { band: 'low' } }],
    ]);
  });

  it('says an asset first measured with no posture was seen without one', async () => {
    const [event] = await criticalAssetsCategory.resolve(withPostures([postureLine('new-01', '2026-10-02T00:00:00Z', null)]));

    expect(event.sentence).toEqual({ key: 'posture-first-seen', parts: { band: 'none' } });
  });

  it('dates an asset on the line from which it kept its final band', async () => {
    const [event] = await criticalAssetsCategory.resolve(withPostures([
      postureLine('fw-edge-01', '2026-09-20T00:00:00Z', 60),
      postureLine('fw-edge-01', '2026-10-02T00:00:00Z', 20),
      postureLine('fw-edge-01', '2026-10-03T00:00:00Z', 55),
      postureLine('fw-edge-01', '2026-10-04T00:00:00Z', 10),
      postureLine('fw-edge-01', '2026-10-05T00:00:00Z', 5),
    ]));

    expect(event.moment).toEqual({ kind: 'recorded', at: '2026-10-04T00:00:00.000Z' });
  });

  it('names an asset by its derived name when it has no name of its own', async () => {
    const [event] = await criticalAssetsCategory.resolve(withPostures([
      { ...postureLine('a1', '2026-10-02T00:00:00Z', 10), name: ' ', derivedName: 'host-42' },
    ]));

    expect(event.item.label).toBe('host-42');
  });
});

type CveChangeRow = Awaited<ReturnType<CategoryResolverInput['repo']['findUniqueFindingChanges']>>[number];

const cveChange = (overrides: Partial<CveChangeRow>): CveChangeRow => ({
  cveId: 'CVE-2024-3400',
  assetsBefore: null,
  assetsAfter: null,
  bandBefore: null,
  bandAfter: null,
  appearedAt: null,
  leftAt: null,
  bandMovedAt: null,
  ...overrides,
});

describe('findings categories', () => {
  const after = compared({ id: 'after' }, '2026-10-06T09:00:00Z');
  const withChanges = (rows: Array<CveChangeRow>, earlier: ComparedRun = before, noLongerReported: Array<string> = []) => between(earlier, after, {
    findScenarioEstate: () => Promise.resolve({ mode: 'open' }),
    findUniqueFindingChanges: () => Promise.resolve(rows),
    findCvesNoLongerReported: () => Promise.resolve(new Set(noLongerReported)),
  });

  it('lists a CVE first reported on 37 assets as one row under Critical findings, raising the loss, dated when it appeared, opening its unique finding', async () => {
    const input = withChanges([cveChange({ assetsAfter: 37, bandAfter: 'critical', appearedAt: new Date('2026-10-03T14:00:00Z') })]);

    expect(await criticalFindingsCategory.resolve(input)).toEqual([{
      category: 'findings-critical',
      moment: { kind: 'recorded', at: '2026-10-03T14:00:00.000Z' },
      direction: 'up',
      item: { kind: 'cve', key: 'CVE-2024-3400', label: 'CVE-2024-3400', link: { kind: 'cve', cveId: 'CVE-2024-3400' } },
      sentence: { key: 'cve-appeared', parts: { count: 37, band: 'critical' } },
      values: null,
    }]);
  });

  it('lists a CVE that left the estate under the band it held, lowering the loss, opening its dismissed findings', async () => {
    const input = withChanges([cveChange({
      cveId: 'CVE-2023-34362', assetsBefore: 3, bandBefore: 'high', leftAt: new Date('2026-10-04T08:00:00Z'),
    })]);
    const [event] = await criticalFindingsCategory.resolve(input);

    expect([event.category, event.direction, event.moment, event.sentence, event.item.link]).toEqual([
      'findings-high',
      'down',
      { kind: 'recorded', at: '2026-10-04T08:00:00.000Z' },
      { key: 'cve-left', parts: { count: 3, band: 'high' } },
      { kind: 'cve-findings', cveId: 'CVE-2023-34362', state: 'dismissed' },
    ]);
  });

  it('tells a CVE its connectors stopped reporting apart from one that left otherwise', async () => {
    const input = withChanges([
      cveChange({ cveId: 'CVE-2023-34362', assetsBefore: 3, bandBefore: 'high' }),
      cveChange({ cveId: 'CVE-2021-44228', assetsBefore: 1, bandBefore: 'high' }),
    ], before, ['CVE-2023-34362']);
    const events = await criticalFindingsCategory.resolve(input);

    expect(events.map((event) => [event.item.key, event.sentence.key])).toEqual([
      ['CVE-2023-34362', 'cve-no-longer-reported'],
      ['CVE-2021-44228', 'cve-left'],
    ]);
  });

  it('lists a CVE moving from High to Critical, raising the loss, dated on the move', async () => {
    const input = withChanges([cveChange({
      assetsBefore: 2, assetsAfter: 2, bandBefore: 'high', bandAfter: 'critical', bandMovedAt: new Date('2026-10-02T00:00:00Z'),
    })]);
    const [event] = await criticalFindingsCategory.resolve(input);

    expect([event.category, event.direction, event.moment, event.sentence]).toEqual([
      'findings-critical',
      'up',
      { kind: 'recorded', at: '2026-10-02T00:00:00.000Z' },
      { key: 'cve-band-moved', parts: { from: 'high', to: 'critical', band: 'critical' } },
    ]);
  });

  it('counts a CVE leaving High for Medium under High findings, lowering the loss', async () => {
    const input = withChanges([cveChange({
      assetsBefore: 2, assetsAfter: 2, bandBefore: 'high', bandAfter: 'medium', bandMovedAt: new Date('2026-10-05T00:00:00Z'),
    })]);
    const [event] = await criticalFindingsCategory.resolve(input);

    expect([event.category, event.direction, event.moment]).toEqual(['findings-high', 'down', { kind: 'recorded', at: '2026-10-05T00:00:00.000Z' }]);
  });

  it('lists no row for a CVE whose asset count alone moved', async () => {
    const input = withChanges([cveChange({ assetsBefore: 2, assetsAfter: 9, bandBefore: 'high', bandAfter: 'high' })]);

    expect(await criticalFindingsCategory.resolve(input)).toEqual([]);
  });

  it('files a CVE with no scored finding under Other findings', async () => {
    const input = withChanges([cveChange({ assetsAfter: 4, appearedAt: new Date('2026-10-03T00:00:00Z') })]);
    const [event] = await criticalFindingsCategory.resolve(input);

    expect([event.category, event.sentence.parts.band]).toEqual(['findings-other', 'none']);
  });

  it('lists nothing against an earlier run older than the unique finding journal', async () => {
    const old = compared({ id: 'old' }, '2026-05-01T00:00:00Z');

    expect(await criticalFindingsCategory.resolve(between(old, after, {}))).toEqual([]);
  });
});

describe('attack frequency category', () => {
  type Estimate = Awaited<ReturnType<CategoryResolverInput['repo']['findTefEstimatesByScenarioId']>>[number];

  const estimate = (id: string, createdAt: string, [min, likely, max]: [number, number, number] = [1, 4, 7]): Estimate =>
    ({ id, catalogVintage: 2, catalogId: null, catalogVersion: null, min, likely, max, countryIsoAlpha3: null, countryName: null, sectorName: null, sizeSource: null, readSizeClasses: null, createdAt: new Date(createdAt) });
  const openData = (id: string, createdAt: string, read: Partial<Estimate>, triplet: [number, number, number] = [1, 4, 7]): Estimate => ({
    ...estimate(id, createdAt, triplet),
    catalogVintage: null,
    catalogId: 'opencrq-open-data',
    catalogVersion: '1.0.0',
    countryIsoAlpha3: 'FRA',
    countryName: 'France',
    sectorName: 'Finance',
    sizeSource: 'employee_count',
    readSizeClasses: ['50-249'],
    ...read,
  });
  const readTef = (estimates: Array<Estimate>, inner: Array<ComparedRun> = []) => ({
    findTefEstimatesByScenarioId: () => Promise.resolve(estimates),
    findRunTefTripletsByIds: (ids: ReadonlyArray<string>) => Promise.resolve(inner.filter(({ run }) => ids.includes(run.id)).map(({ run }) => run)),
  });
  const after = compared({ id: 'after' }, '2026-10-06T09:00:00Z');
  const tefLink = { kind: 'scenario-tab', tab: 'threat' };

  it('explains an employee count that moved the size class in one sentence', async () => {
    const estimates = [openData('first', '2026-09-20T00:00:00Z', {}), openData('second', '2026-10-03T08:00:00Z', { readSizeClasses: ['250-999'] })];

    const events = await attackFrequencyCategory.resolve(between(before, after, readTef(estimates)));

    expect(events).toEqual([{
      category: 'attack-frequency',
      moment: { kind: 'recorded', at: '2026-10-03T08:00:00.000Z' },
      direction: 'none',
      item: { kind: 'tef-read', key: 'size', label: null, link: tefLink },
      sentence: { key: 'tef-size-changed', parts: { before: '50-249', after: '250-999', beforeSource: 'employee_count', afterSource: 'employee_count' } },
      values: null,
    }]);
  });

  it('explains a moved country, and a size read from the revenue band once the employee count is cleared', async () => {
    const estimates = [
      openData('first', '2026-09-20T00:00:00Z', {}),
      openData('second', '2026-10-02T00:00:00Z', { countryIsoAlpha3: 'DEU', countryName: 'Germany' }, [1, 3, 7]),
      openData('third', '2026-10-04T00:00:00Z', { countryIsoAlpha3: 'DEU', countryName: 'Germany', sizeSource: 'revenue_band', readSizeClasses: ['10-49', '50-249', '250-999'] }),
    ];

    const events = await attackFrequencyCategory.resolve(between(before, after, readTef(estimates)));

    expect(events.map(({ direction, item, sentence }) => ({ direction, key: item.key, sentence }))).toEqual([
      { direction: 'down', key: 'country', sentence: { key: 'tef-country-changed', parts: { before: 'France', after: 'Germany' } } },
      { direction: 'up', key: 'size', sentence: { key: 'tef-size-changed', parts: { before: '50-249', after: '10-49, 50-249, 250-999', beforeSource: 'employee_count', afterSource: 'revenue_band' } } },
    ]);
  });

  it('names no class for a read with no size declared, whichever classes it mixed', async () => {
    const estimates = [
      openData('first', '2026-09-20T00:00:00Z', { sizeSource: 'none', readSizeClasses: [] }),
      openData('second', '2026-10-02T00:00:00Z', { sizeSource: 'none', readSizeClasses: TEF_EVERY_SIZE.map((share) => share.sizeClass) }),
      openData('third', '2026-10-04T00:00:00Z', {}),
    ];

    const events = await attackFrequencyCategory.resolve(between(before, after, readTef(estimates)));

    expect(events.map(({ item, sentence }) => ({ key: item.key, sentence }))).toEqual([
      { key: 'size', sentence: { key: 'tef-size-changed', parts: { before: '', after: '50-249', beforeSource: 'none', afterSource: 'employee_count' } } },
    ]);
  });

  it('explains the move from a multiplier estimate to a catalogue package by the catalogue alone', async () => {
    const estimates = [estimate('first', '2026-09-20T00:00:00Z'), openData('second', '2026-10-03T08:00:00Z', {})];

    const events = await attackFrequencyCategory.resolve(between(before, after, readTef(estimates)));

    expect(events.map(({ direction, item, sentence }) => ({ direction, key: item.key, sentence }))).toEqual([
      { direction: 'none', key: 'catalogue', sentence: { key: 'tef-catalogue-changed', parts: { beforeVintage: 2, after: 'opencrq-open-data 1.0.0' } } },
    ]);
  });

  it('names a new version of the same catalogue by its versions, beside the profile field that moved with it', async () => {
    const estimates = [openData('first', '2026-09-20T00:00:00Z', {}), openData('second', '2026-10-03T08:00:00Z', { catalogVersion: '1.1.0', readSizeClasses: ['250-999'] })];

    const events = await attackFrequencyCategory.resolve(between(before, after, readTef(estimates)));

    expect(events.map(({ direction, item, sentence }) => ({ direction, key: item.key, sentence }))).toEqual([
      { direction: 'none', key: 'catalogue', sentence: { key: 'tef-catalogue-version-changed', parts: { before: '1.0.0', after: '1.1.0' } } },
      { direction: 'none', key: 'size', sentence: { key: 'tef-size-changed', parts: { before: '50-249', after: '250-999', beforeSource: 'employee_count', afterSource: 'employee_count' } } },
    ]);
  });

  it('names a new version of the same catalogue alone when the profile did not move', async () => {
    const estimates = [openData('first', '2026-09-20T00:00:00Z', {}), openData('second', '2026-10-03T08:00:00Z', { catalogVersion: '1.1.0' })];

    const events = await attackFrequencyCategory.resolve(between(before, after, readTef(estimates)));

    expect(events.map(({ item }) => item.key)).toEqual(['catalogue']);
  });

  it('lists no sentence between two estimates of the multiplier vintages, which record no read', async () => {
    const estimates = [{ ...estimate('first', '2026-09-20T00:00:00Z'), catalogVintage: 1 }, estimate('second', '2026-10-03T08:00:00Z')];

    const events = await attackFrequencyCategory.resolve(between(before, after, readTef(estimates)));

    expect(events).toEqual([]);
  });

  it('lists nothing between two runs that drew the same automatic estimate', async () => {
    const events = await attackFrequencyCategory.resolve(between(before, after, readTef([estimate('first', '2026-09-20T00:00:00Z')])));

    expect(events).toEqual([]);
  });

  it('reads a run older than every estimate as automatic when it drew the first one, written while it read', async () => {
    const events = await attackFrequencyCategory.resolve(between(before, after, readTef([estimate('first', '2026-10-01T09:00:05Z')])));

    expect(events).toEqual([]);
  });

  it('lists a switch from automatic to manual once, on the later run, with both triplets', async () => {
    const manual = compared({ id: 'after', tefMin: 2, tefLikely: 3, tefMax: 6 }, '2026-10-06T09:00:00Z');

    const events = await attackFrequencyCategory.resolve(between(before, manual, readTef([estimate('first', '2026-09-20T00:00:00Z')])));

    expect(events).toEqual([{
      category: 'attack-frequency',
      moment: { kind: 'run', runId: 'after' },
      direction: 'down',
      item: { kind: 'tef-input', key: 'mode', label: null, link: tefLink },
      sentence: { key: 'tef-mode-manual', parts: { beforeMin: 1, beforeLikely: 4, beforeMax: 7, afterMin: 2, afterLikely: 3, afterMax: 6 } },
      values: null,
    }]);
  });

  it('lists a raised manual triplet as up, and no read the manual frequency does not take', async () => {
    const earlier = compared({ id: 'before', tefMin: 3, tefLikely: 4, tefMax: 6 }, '2026-10-01T09:00:00Z');
    const later = compared({ id: 'after', tefMin: 4, tefLikely: 5, tefMax: 8 }, '2026-10-06T09:00:00Z');
    const estimates = [openData('first', '2026-09-20T00:00:00Z', {}), openData('second', '2026-10-03T08:00:00Z', { readSizeClasses: ['250-999'] })];

    const events = await attackFrequencyCategory.resolve(between(earlier, later, readTef(estimates)));

    expect(events).toEqual([expect.objectContaining({
      moment: { kind: 'run', runId: 'after' },
      direction: 'up',
      item: expect.objectContaining({ kind: 'tef-input', key: 'manual-triplet' }),
      sentence: { key: 'tef-manual-changed', parts: { beforeMin: 3, beforeLikely: 4, beforeMax: 6, afterMin: 4, afterLikely: 5, afterMax: 8 } },
    })]);
  });

  it('hangs a mode switch on the earliest run from which the later run kept its mode', async () => {
    const manualAt = (id: string, at: string) => compared({ id, tefMin: 3, tefLikely: 4, tefMax: 6, createdAt: new Date(at) }, at);
    const inner = [
      compared({ id: 'auto', createdAt: new Date('2026-10-02T09:00:00Z') }, '2026-10-02T09:00:00Z'),
      manualAt('switched', '2026-10-03T09:00:00Z'),
      manualAt('kept', '2026-10-04T09:00:00Z'),
    ];
    const manual = compared({ id: 'after', tefMin: 3, tefLikely: 4, tefMax: 6 }, '2026-10-06T09:00:00Z');

    const events = await attackFrequencyCategory.resolve(between(before, manual, readTef([estimate('first', '2026-09-20T00:00:00Z')], inner), inner.map(windowRun)));

    expect(events.map((event) => event.moment)).toEqual([{ kind: 'run', runId: 'switched' }]);
  });

  it('lists nothing when an end stored no frequency', async () => {
    const unpriced = compared({ id: 'before', tefMin: null, tefLikely: null, tefMax: null }, '2026-10-01T09:00:00Z');

    const events = await attackFrequencyCategory.resolve(between(unpriced, after, readTef([estimate('first', '2026-09-20T00:00:00Z')])));

    expect(events).toEqual([]);
  });
});
