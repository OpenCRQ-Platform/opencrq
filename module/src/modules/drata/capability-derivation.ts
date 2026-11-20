import type { CoverageBucket, StrengthRung } from '../controls/capability/constants';
import { STRENGTH_REFERENCE_RUNGS, STRENGTH_RUNGS } from '../controls/capability/constants';
import { DRATA_DCF_CAPABILITY_EVIDENCE } from './data/drata-capability-mapping.generated';

export interface DerivedAssessment {
  readonly capabilityExternalId: string,
  readonly strengthRung: StrengthRung,
  readonly coverageBucket: CoverageBucket,
  /**
   * Whether the coverage read slices or ready org-wide evidence. False when it fell back on partial,
   * and when strength L0 pinned it at L0, which follows from the strength and measures nothing.
   */
  readonly coverageMeasured: boolean,
  /**
   * Whether the strength is the most the mirrored evidence could prove, every pair ready: Drata is
   * then silent above it, where a lower strength is a failure it saw.
   */
  readonly atCeiling: boolean,
  /** The mirror codes the derivation read, ready or not: the assessment's evidence trail. */
  readonly supportingCodes: ReadonlyArray<string>,
}

/**
 * The capabilities the mapping keys at least one evidence pair for. Any other capability is one
 * Drata attests nothing about, whatever the mirror holds: a value it once derived there has no
 * evidence left behind it, unlike one whose mapped codes are only absent from the mirror for now.
 */
export const DRATA_EVIDENCED_CAPABILITY_EXTERNAL_IDS: ReadonlyArray<string> = Object.entries(DRATA_DCF_CAPABILITY_EVIDENCE)
  .filter(([, pairs]) => pairs.length > 0)
  .map(([externalId]) => externalId);

export const DRATA_ATTESTED_LEVELS = STRENGTH_REFERENCE_RUNGS;
export const DRATA_EVIDENCE_REACHES = ['org_wide', 'slice'] as const;

/** One mapped Drata control's evidence for a capability, as the generator emits it. */
export interface DrataEvidencePair {
  readonly code: string,
  readonly levels: ReadonlyArray<typeof DRATA_ATTESTED_LEVELS[number]>,
  readonly reach?: typeof DRATA_EVIDENCE_REACHES[number],
}

/** The generated mapping, bound to the evidence vocabulary: a value outside it fails to compile here. */
export const DRATA_EVIDENCE_BY_EXTERNAL_ID: Readonly<Record<string, ReadonlyArray<DrataEvidencePair>>> = DRATA_DCF_CAPABILITY_EVIDENCE;

/**
 * The share of a level's counted pairs that must be ready for the level to hold. Below 1 so that one
 * pair whose Drata evidence lapsed, with the mechanism still running, does not drop a level carried
 * by four pairs or more; up to three pairs it still takes all of them.
 */
const LEVEL_READY_SHARE = 0.75;

/**
 * The highest level whose evidence holds with every level below it. A level holds when one of its
 * pairs is ready and the ready ones reach {@link LEVEL_READY_SHARE} of those counted. A failing
 * slice is left out of the count: it says that slice is uncovered, which coverage already reports.
 */
const strengthOf = (present: ReadonlyArray<DrataEvidencePair>, isReady: (pair: DrataEvidencePair) => boolean): number => {
  let rung = 0;
  for (const level of DRATA_ATTESTED_LEVELS) {
    const attesting = present.filter((pair) => pair.levels.includes(level));
    const ready = attesting.filter(isReady).length;
    const counted = attesting.filter((pair) => isReady(pair) || pair.reach !== 'slice').length;
    if (ready === 0 || ready < Math.ceil(LEVEL_READY_SHARE * counted)) {
      break;
    }
    rung += 1;
  }
  return rung;
};

const coverageOf = (present: ReadonlyArray<DrataEvidencePair>, isReady: (pair: DrataEvidencePair) => boolean): CoverageBucket => {
  const slices = present.filter((pair) => pair.reach === 'slice');
  const slicesReady = slices.filter(isReady).length;
  // A ready org-wide pair is coverage evidence too: its text claims the whole unit, so it floors
  // the bucket at broad and backs an otherwise vacuous single-slice full.
  const orgWideReady = present.some((pair) => pair.reach === 'org_wide' && isReady(pair));
  if (slices.length === 0) {
    return orgWideReady ? 'L2' : 'L1';
  }
  if (slicesReady === slices.length) {
    return slices.length < 2 && !orgWideReady ? 'L2' : 'L3';
  }
  if (slicesReady >= slices.length / 2 || orgWideReady) {
    return 'L2';
  }
  return 'L1';
};

/**
 * Turns the tenant's mirrored control readiness into capability assessments, per the levels each
 * pair attests. Evidence pairs whose code is absent from the mirror count for nothing, and so does
 * a capability whose present pairs say nothing of L1: no reading then, rather than an L0 its
 * evidence does not support. Coverage reads only the pairs attesting a level the strength holds,
 * and strength L0 covers nothing, so it pins coverage at L0.
 */
export const deriveCapabilityAssessments = (
  readyByCode: ReadonlyMap<string, boolean>,
): Array<DerivedAssessment> => {
  const isReady = (pair: DrataEvidencePair): boolean => readyByCode.get(pair.code) === true;
  const derived: Array<DerivedAssessment> = [];
  for (const [externalId, pairs] of Object.entries(DRATA_EVIDENCE_BY_EXTERNAL_ID)) {
    const present = pairs.filter((pair) => readyByCode.has(pair.code));
    if (!present.some((pair) => pair.levels.includes('L1'))) {
      continue;
    }
    const strength = strengthOf(present, isReady);
    const ceiling = strengthOf(present, () => true);
    // A pair's reach is that of the mechanism it attests: one attesting only levels above the
    // strength says where a mechanism the control lacks would run.
    const held = present.filter((pair) => pair.levels.some((level) => STRENGTH_RUNGS.indexOf(level) <= strength));
    derived.push({
      capabilityExternalId: externalId,
      strengthRung: STRENGTH_RUNGS[strength],
      coverageBucket: strength === 0 ? 'L0' : coverageOf(held, isReady),
      coverageMeasured: strength > 0 && held.some((pair) => pair.reach === 'slice' || (pair.reach === 'org_wide' && isReady(pair))),
      supportingCodes: present.map((pair) => pair.code),
      atCeiling: strength === ceiling,
    });
  }
  return derived;
};
