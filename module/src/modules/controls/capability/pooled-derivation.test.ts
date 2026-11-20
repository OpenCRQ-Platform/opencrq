import { describe, expect, it } from 'vitest';
import type { AnswerCapabilityReading, DrataCapabilityReading } from './pooled-derivation';
import { deriveCapabilityAssessments } from '../../drata/capability-derivation';
import { DRATA_DCF_CAPABILITY_EVIDENCE } from '../../drata/data/drata-capability-mapping.generated';
import { poolCapabilityAssessments } from './pooled-derivation';

const CSF = 'nist-csf-2.0';
const ISO = 'iso-27001';
const T2 = { assessmentId: '0199a000-0000-7000-8000-000000000002', assessmentName: 'T2 2026' };
const T4 = { assessmentId: '0199a000-0000-7000-8000-000000000004', assessmentName: 'T4 2025' };
const DRATA_FEED = { source: 'drata', complianceAssessmentId: null, complianceAssessmentName: null };
const feed = (source: string, assessment: { assessmentId: string, assessmentName: string }) =>
  ({ source, complianceAssessmentId: assessment.assessmentId, complianceAssessmentName: assessment.assessmentName });

const drata = (overrides: Partial<DrataCapabilityReading> = {}): DrataCapabilityReading => ({
  capabilityId: 'IDP',
  strengthRung: 'L2',
  coverageBucket: 'L2',
  coverageMeasured: true,
  atCeiling: false,
  ...overrides,
});

const answer = (
  level: number,
  axis: AnswerCapabilityReading['axis'] = 'capability',
  capabilityId = 'IDP',
  source = CSF,
  assessment = T2,
): AnswerCapabilityReading => ({ capabilityId, axis, level, source, ...assessment });

const poolOne = (readings: Array<DrataCapabilityReading>, answers: Array<AnswerCapabilityReading>) => {
  const pooled = poolCapabilityAssessments(readings, answers);
  expect(pooled).toHaveLength(1);
  return pooled[0];
};

const ALL_CODES = [...new Set(Object.values(DRATA_DCF_CAPABILITY_EVIDENCE).flatMap((pairs) => pairs.map((pair) => pair.code)))].sort();

/** A deterministic readiness draw over every mapped code, some codes left out of the mirror. */
const readinessFixture = (seed: number): Map<string, boolean> => {
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  return new Map(ALL_CODES.flatMap((code) => {
    const draw = next();
    return draw < 0.15 ? [] : [[code, draw > 0.5] as const];
  }));
};

describe('poolCapabilityAssessments', () => {
  describe('on a tenant with Drata and no published assessment', () => {
    const fixtures: Array<[string, Map<string, boolean>]> = [
      ['every mapped control ready', new Map(ALL_CODES.map((code) => [code, true]))],
      ['no mapped control ready', new Map(ALL_CODES.map((code) => [code, false]))],
      ...[1, 7, 42, 1_234, 99_991].map((seed): [string, Map<string, boolean>] => [`readiness draw ${seed}`, readinessFixture(seed)]),
    ];

    it.each(fixtures)('writes exactly what the Drata derivation writes, %s', (_, readiness) => {
      const derived = deriveCapabilityAssessments(readiness);
      const pooled = poolCapabilityAssessments(derived.map((entry) => ({
        capabilityId: entry.capabilityExternalId,
        strengthRung: entry.strengthRung,
        coverageBucket: entry.coverageBucket,
        coverageMeasured: entry.coverageMeasured,
        atCeiling: entry.atCeiling,
      })), []);

      expect(pooled.map((entry) => ({
        capabilityId: entry.capabilityId,
        strengthRung: entry.strengthRung,
        coverageBucket: entry.coverageBucket,
      }))).toEqual(derived.map((entry) => ({
        capabilityId: entry.capabilityExternalId,
        strengthRung: entry.strengthRung,
        coverageBucket: entry.coverageBucket,
      })).sort((a, b) => a.capabilityId.localeCompare(b.capabilityId)));
      expect(pooled.every((entry) => entry.strengthSources.join() === 'drata' && entry.coverageSources.join() === 'drata')).toBe(true);
    });
  });

  describe('strength', () => {
    it('pools Drata and the answers on the worked IAM case: L2', () => {
      const iam = poolOne([drata()], [answer(3), answer(3), answer(1), answer(3)]);
      // (2 x 1 + 1.75 x 0.5) / 1.5 = 1.92
      expect(iam.strengthRung).toBe('L2');
      expect(iam.strengthSources).toEqual(['drata', CSF]);
    });

    it('maps each answer to a rung before averaging them', () => {
      // The answer levels average L2, which reads strength L1; their rungs average 1.5, strength L2.
      expect(poolOne([], [answer(0), answer(4)]).strengthRung).toBe('L2');
    });

    it('rounds to the nearest rung, a half rounding up', () => {
      expect(poolOne([], [answer(2), answer(3)]).strengthRung).toBe('L2');
    });

    it('weighs the answers half a Drata reading however many they are, so Drata still dominates', () => {
      const pooled = poolOne([drata({ strengthRung: 'L1' })], [answer(5), answer(5), answer(5), answer(5), answer(5)]);
      // (1 x 1 + 3 x 0.5) / 1.5 = 1.67
      expect(pooled.strengthRung).toBe('L2');
      // (0 x 1 + 3 x 0.5) / 1.5 = 1
      expect(poolOne([drata({ strengthRung: 'L0' })], [answer(5)]).strengthRung).toBe('L1');
    });

    it('lets answers above a reading at Drata\'s ceiling through, Drata being silent above it', () => {
      const atCeiling = drata({ strengthRung: 'L1', atCeiling: true });
      // Drata votes the answers' mean 2: (2 x 1 + 2 x 0.5) / 1.5 = 2
      expect(poolOne([atCeiling], [answer(3), answer(3)]).strengthRung).toBe('L2');
      expect(poolOne([atCeiling], [answer(4)]).strengthRung).toBe('L3');
    });

    it('lets lower answers pull a reading at its ceiling down as they would one below it', () => {
      // (2 x 1 + 0 x 0.5) / 1.5 = 1.33
      expect(poolOne([drata({ strengthRung: 'L2', atCeiling: true })], [answer(0)]).strengthRung).toBe('L1');
      expect(poolOne([drata({ strengthRung: 'L2', atCeiling: false })], [answer(0)]).strengthRung).toBe('L1');
    });

    it('keeps a reading below its ceiling as a measure against higher answers', () => {
      // (1 x 1 + 2 x 0.5) / 1.5 = 1.33
      expect(poolOne([drata({ strengthRung: 'L1', atCeiling: false })], [answer(3), answer(3)]).strengthRung).toBe('L1');
    });

    it('reads an L0 answer as strength L0', () => {
      expect(poolOne([], [answer(0)]).strengthRung).toBe('L0');
    });
  });

  describe('coverage', () => {
    it('assumes a coverage from the capability answers without Drata, with its level', () => {
      const pooled = poolOne([], [answer(2), answer(2)]);
      expect(pooled.coverageBucket).toBe('L1');
      expect(pooled.coverageBasis).toBe('assumed');
      expect(pooled.assumedFromLevel).toBe(2);
      expect(pooled.coverageSources).toEqual([CSF]);
    });

    it('assumes the bucket of the rounded mean level, the level the card shows beside it', () => {
      // L3 L3 L1 L3 average 2.5, shown L3: broad.
      expect(poolOne([], [answer(3), answer(3), answer(1), answer(3)])).toMatchObject({ coverageBucket: 'L2', assumedFromLevel: 3 });
      // L1 L1 L4 average 2, shown L2: partial, where their buckets would have averaged 1.67, broad.
      expect(poolOne([], [answer(1), answer(1), answer(4)])).toMatchObject({ coverageBucket: 'L1', assumedFromLevel: 2 });
    });

    it('takes a coverage-typed answer as the coverage, no longer assumed, and leaves the strength to the capability answers', () => {
      const pooled = poolOne([], [answer(3), answer(1, 'coverage')]);
      expect(pooled.strengthRung).toBe('L2');
      expect(pooled.coverageBucket).toBe('L1');
      expect(pooled.coverageBasis).toBe('typed');
      expect(pooled.assumedFromLevel).toBeNull();
    });

    it('gives a control whose answers only speak to its coverage that coverage, and no strength', () => {
      expect(poolOne([], [answer(4, 'coverage')])).toMatchObject({
        strengthRung: null,
        strengthSources: [],
        coverageBucket: 'L3',
        coverageBasis: 'typed',
      });
    });

    it('prefers a Drata measure over a coverage-typed answer', () => {
      const pooled = poolOne([drata({ coverageBucket: 'L3' })], [answer(1, 'coverage')]);
      expect(pooled.coverageBucket).toBe('L3');
      expect(pooled.coverageBasis).toBe('measured');
      expect(pooled.coverageSources).toEqual(['drata']);
    });

    it('prefers the assumed coverage over the partial Drata falls back on when it measured nothing', () => {
      const pooled = poolOne([drata({ coverageBucket: 'L1', coverageMeasured: false })], [answer(4)]);
      expect(pooled.coverageBucket).toBe('L3');
      expect(pooled.coverageBasis).toBe('assumed');
    });

    it('leaves coverage to the answers when a Drata strength L0 only pinned it at L0', () => {
      const pooled = poolOne([drata({ strengthRung: 'L0', coverageBucket: 'L0', coverageMeasured: false })], [answer(4), answer(3, 'coverage')]);
      // (0 x 1 + 3 x 0.5) / 1.5 = 1
      expect(pooled.strengthRung).toBe('L1');
      expect(pooled.coverageBucket).toBe('L2');
      expect(pooled.coverageBasis).toBe('typed');
    });

    it("keeps Drata's own fallback when no answer reaches the control", () => {
      const pooled = poolOne([drata({ coverageBucket: 'L1', coverageMeasured: false })], []);
      expect(pooled.coverageBucket).toBe('L1');
      expect(pooled.coverageBasis).toBe('measured');
    });
  });

  describe('feeds', () => {
    it('names Drata without an assessment, then each assessment the answers came from', () => {
      const iam = poolOne([drata()], [answer(3), answer(2)]);
      expect(iam.strengthFeeds).toEqual([DRATA_FEED, feed(CSF, T2)]);
      expect(iam.coverageFeeds).toEqual([DRATA_FEED]);
    });

    it('lists two assessments of one framework when the answers feeding the value came from both', () => {
      const iam = poolOne([], [answer(3), answer(3), answer(1, 'capability', 'IDP', CSF, T4), answer(3)]);
      expect(iam.strengthFeeds).toEqual([feed(CSF, T2), feed(CSF, T4)]);
      expect(iam.strengthSources).toEqual([CSF]);
    });

    it('keeps the sources equal to the distinct sources of the feeds, Drata first', () => {
      const iam = poolOne([drata()], [answer(3, 'capability', 'IDP', ISO, T4), answer(2), answer(1, 'capability', 'IDP', CSF, T4)]);
      expect(iam.strengthFeeds).toEqual([DRATA_FEED, feed(ISO, T4), feed(CSF, T2), feed(CSF, T4)]);
      expect(iam.strengthSources).toEqual(['drata', ISO, CSF]);
    });

    it('feeds an assumed coverage from the capability answers', () => {
      const pooled = poolOne([], [answer(2), answer(2, 'capability', 'IDP', CSF, T4)]);
      expect(pooled.coverageBasis).toBe('assumed');
      expect(pooled.coverageFeeds).toEqual([feed(CSF, T2), feed(CSF, T4)]);
    });

    it('feeds a typed coverage from the coverage answers alone', () => {
      const pooled = poolOne([], [answer(3, 'capability', 'IDP', CSF, T4), answer(1, 'coverage')]);
      expect(pooled.coverageBasis).toBe('typed');
      expect(pooled.coverageFeeds).toEqual([feed(CSF, T2)]);
      expect(pooled.strengthFeeds).toEqual([feed(CSF, T4)]);
    });
  });

  it('keeps every control apart', () => {
    const pooled = poolCapabilityAssessments([drata()], [answer(0, 'capability', 'EDR')]);
    expect(pooled.map((entry) => entry.capabilityId)).toEqual(['EDR', 'IDP']);
    expect(pooled.find((entry) => entry.capabilityId === 'EDR')!.strengthSources).toEqual([CSF]);
  });
});
