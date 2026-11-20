import type { CoverageBasis, CoverageBucket, StrengthRung } from './constants';
import type { ControlLinkAxis } from '../../compliance-assessments/constants';
import { COVERAGE_BUCKETS, DRATA_SOURCE, STRENGTH_RUNGS } from './constants';

export interface DrataCapabilityReading {
  capabilityId: string,
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
  /** False when the reading counted neither a slice nor ready org-wide evidence, or pinned coverage at L0 with its strength: its coverage is then Drata's default, not a measure. */
  coverageMeasured: boolean,
  /** True when the strength is the most Drata's mirrored evidence could prove: Drata is then silent above it. */
  atCeiling: boolean,
}

/** One latest published answer reaching a control through a typed link. */
export interface AnswerCapabilityReading {
  capabilityId: string,
  axis: ControlLinkAxis,
  level: number,
  /** The key of the framework the answer was given on. */
  source: string,
  assessmentId: string,
  assessmentName: string,
}

export interface DerivationFeed {
  source: string,
  complianceAssessmentId: string | null,
  complianceAssessmentName: string | null,
}

/** The strength is null when only coverage-typed answers reach the control. */
export interface PooledAssessment {
  capabilityId: string,
  strengthRung: StrengthRung | null,
  strengthSources: Array<string>,
  strengthFeeds: Array<DerivationFeed>,
  coverageBucket: CoverageBucket,
  coverageBasis: Exclude<CoverageBasis, 'declared'>,
  coverageSources: Array<string>,
  coverageFeeds: Array<DerivationFeed>,
  /** The mean maturity level an assumed coverage was read from, rounded; null for any other basis. */
  assumedFromLevel: number | null,
}

/** L0 to L5 onto the four rungs and the four buckets alike: L0, L1-L2, L3, L4-L5. */
const STEP_BY_LEVEL: ReadonlyArray<number> = [0, 1, 1, 2, 3, 3];

const DRATA_WEIGHT = 1;

/** Self-declared process maturity: however many answers back it, it never outweighs a connector reading. */
const ASSESSMENT_WEIGHT = 0.5;

const stepOf = (level: number): number => STEP_BY_LEVEL[level] ?? 0;

const mean = (values: ReadonlyArray<number>): number => values.reduce((sum, value) => sum + value, 0) / values.length;

const compareCodeUnits = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

const DRATA_FEED: DerivationFeed = { source: DRATA_SOURCE, complianceAssessmentId: null, complianceAssessmentName: null };

const feedsOf = (answers: ReadonlyArray<AnswerCapabilityReading>): Array<DerivationFeed> =>
  [...new Map(answers.map((answer) => [`${answer.source}:${answer.assessmentId}`, {
    source: answer.source,
    complianceAssessmentId: answer.assessmentId,
    complianceAssessmentName: answer.assessmentName,
  }])).values()].toSorted((a, b) =>
    compareCodeUnits(a.source, b.source)
    || compareCodeUnits(a.complianceAssessmentName ?? '', b.complianceAssessmentName ?? '')
    || compareCodeUnits(a.complianceAssessmentId ?? '', b.complianceAssessmentId ?? ''));

const sourcesOf = (feeds: ReadonlyArray<DerivationFeed>): Array<string> => [...new Set(feeds.map((feed) => feed.source))];

const bucketOf = (answers: ReadonlyArray<AnswerCapabilityReading>): CoverageBucket =>
  COVERAGE_BUCKETS[Math.round(mean(answers.map((answer) => stepOf(answer.level))))] ?? 'L0';

type PooledCoverage = Pick<PooledAssessment, 'coverageBucket' | 'coverageBasis' | 'coverageFeeds' | 'assumedFromLevel'>;

/**
 * Measured, then typed, then assumed from the rounded mean level of the capability answers, then
 * Drata's own default. The last step only ever serves a control no answer reaches, which is what
 * keeps a Drata-only tenant's coverage where Drata alone put it.
 */
const cascadeCoverage = (
  reading: DrataCapabilityReading | undefined,
  capabilityAnswers: ReadonlyArray<AnswerCapabilityReading>,
  coverageAnswers: ReadonlyArray<AnswerCapabilityReading>,
): PooledCoverage | null => {
  if (reading?.coverageMeasured) {
    return {
      coverageBucket: reading.coverageBucket,
      coverageBasis: 'measured',
      coverageFeeds: [DRATA_FEED],
      assumedFromLevel: null,
    };
  }
  if (coverageAnswers.length > 0) {
    return {
      coverageBucket: bucketOf(coverageAnswers),
      coverageBasis: 'typed',
      coverageFeeds: feedsOf(coverageAnswers),
      assumedFromLevel: null,
    };
  }
  if (capabilityAnswers.length > 0) {
    // The bucket follows the one level the card shows beside it, so "Assumed · L2" never sits next to broad.
    const assumedFromLevel = Math.round(mean(capabilityAnswers.map((answer) => answer.level)));
    return {
      coverageBucket: COVERAGE_BUCKETS[stepOf(assumedFromLevel)] ?? 'L0',
      coverageBasis: 'assumed',
      coverageFeeds: feedsOf(capabilityAnswers),
      assumedFromLevel,
    };
  }
  if (reading) {
    return {
      coverageBucket: reading.coverageBucket,
      coverageBasis: 'measured',
      coverageFeeds: [DRATA_FEED],
      assumedFromLevel: null,
    };
  }
  return null;
};

/**
 * One value per control from every source at once. Strength is the weighted mean on L0-L3 of
 * Drata's reading and of the capability-typed answers (each mapped to a rung first, then averaged),
 * rounded to the nearest rung. A reading at Drata's ceiling votes the answers' mean when that is
 * higher, since Drata is silent above it; lower answers still weigh, and can pull the pooled
 * strength below Drata's. A control with no strength reading gets its coverage alone, which
 * feeds a row that already exists but never creates one.
 */
export const poolCapabilityAssessments = (
  drataReadings: ReadonlyArray<DrataCapabilityReading>,
  answers: ReadonlyArray<AnswerCapabilityReading>,
): Array<PooledAssessment> => {
  const readingByCapability = new Map(drataReadings.map((reading) => [reading.capabilityId, reading]));
  const answersByCapability = Map.groupBy(answers, (answer) => answer.capabilityId);
  const capabilityIds = [...new Set([...readingByCapability.keys(), ...answersByCapability.keys()])].sort();

  return capabilityIds.flatMap((capabilityId) => {
    const reading = readingByCapability.get(capabilityId);
    const linked = answersByCapability.get(capabilityId) ?? [];
    const capabilityAnswers = linked.filter((answer) => answer.axis === 'capability');
    const coverageAnswers = linked.filter((answer) => answer.axis === 'coverage');

    const answersStep = capabilityAnswers.length > 0 ? mean(capabilityAnswers.map((answer) => stepOf(answer.level))) : null;
    let totalWeight = 0;
    let weightedSteps = 0;
    if (reading) {
      const drataStep = STRENGTH_RUNGS.indexOf(reading.strengthRung);
      totalWeight += DRATA_WEIGHT;
      weightedSteps += DRATA_WEIGHT * (reading.atCeiling && answersStep !== null ? Math.max(drataStep, answersStep) : drataStep);
    }
    if (answersStep !== null) {
      totalWeight += ASSESSMENT_WEIGHT;
      weightedSteps += ASSESSMENT_WEIGHT * answersStep;
    }
    const coverage = cascadeCoverage(reading, capabilityAnswers, coverageAnswers);
    if (coverage === null) {
      return [];
    }
    const strengthFeeds = [...(reading ? [DRATA_FEED] : []), ...feedsOf(capabilityAnswers)];
    return [{
      capabilityId,
      strengthRung: totalWeight === 0 ? null : STRENGTH_RUNGS[Math.round(weightedSteps / totalWeight)] ?? 'L0',
      strengthSources: sourcesOf(strengthFeeds),
      strengthFeeds,
      ...coverage,
      coverageSources: sourcesOf(coverage.coverageFeeds),
    }];
  });
};
