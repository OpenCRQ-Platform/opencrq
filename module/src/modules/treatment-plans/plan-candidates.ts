import type { CrqControlWhatIfDimension } from '../crq-indicators/schema';
import type { CoverageBucket, StrengthRung } from '../controls/capability/constants';
import { DEFAULT_COVERAGE_BUCKET, DEFAULT_STRENGTH_RUNG } from '../controls/capability/scope-posture';

export interface PlanCandidateCapability {
  id: string,
  externalId: string,
  name: string,
}

/** The scope's resolved posture, the only one a plan may read: a capability's assessment is the tenant's. */
export interface PlanCandidatePosture {
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
}

export interface PlanCandidateMove {
  capabilityId: string,
  targetStrengthRung: StrengthRung | null,
  targetCoverageBucket: CoverageBucket | null,
}

export interface PlanLeverRow {
  controlId: string,
  dimension: CrqControlWhatIfDimension,
  aleReduction: number | null,
}

interface PlanCandidateGains {
  strengthAleReduction: number | null,
  coverageAleReduction: number | null,
  deployAleReduction: number | null,
}

const NO_GAINS: PlanCandidateGains = {
  strengthAleReduction: null,
  coverageAleReduction: null,
  deployAleReduction: null,
};

const GAIN_OF_LEVER: Record<CrqControlWhatIfDimension, keyof PlanCandidateGains> = {
  strength: 'strengthAleReduction',
  coverage: 'coverageAleReduction',
  deploy: 'deployAleReduction',
};

const sumLevers = (rows: Array<PlanLeverRow>): Map<string, PlanCandidateGains> => {
  const byControl = new Map<string, PlanCandidateGains>();
  for (const row of rows) {
    const field = GAIN_OF_LEVER[row.dimension];
    if (row.aleReduction === null) {
      continue;
    }
    const gains = byControl.get(row.controlId) ?? { ...NO_GAINS };
    gains[field] = (gains[field] ?? 0) + row.aleReduction;
    byControl.set(row.controlId, gains);
  }
  return byControl;
};

const bestLever = (gains: PlanCandidateGains): number | null =>
  [gains.strengthAleReduction, gains.coverageAleReduction, gains.deployAleReduction]
    .reduce<number | null>((best, gain) => (gain !== null && (best === null || gain > best) ? gain : best), null);

export interface PlanCandidate {
  capabilityId: string,
  externalId: string,
  name: string,
  /**
   * The scope's posture, overlay included, which is the rung the run prices a move against. An
   * undeclared control is read as deployed nowhere, which is what the engine prices it at.
   */
  currentStrengthRung: StrengthRung,
  currentCoverageBucket: CoverageBucket,
  targetStrengthRung: StrengthRung | null,
  targetCoverageBucket: CoverageBucket | null,
  inPlan: boolean,
  /**
   * What the run says one step of each lever would remove, alone, summed over the scope's
   * scenarios. These rank candidates against each other and are never a control's share of the
   * plan: two controls covering the same technique return less together than apart.
   *
   * A control deployed nowhere is priced on its anchor step alone, which necessarily moves both
   * axes, so it carries `deployAleReduction` and nothing on any axis of its own.
   */
  strengthAleReduction: number | null,
  coverageAleReduction: number | null,
  deployAleReduction: number | null,
}

/**
 * Every control the plan could move, ranked by the best single step it offers across the scope.
 *
 * A lever the runs never priced keeps a null figure rather than a zero: the two are different
 * claims, and sorting a null as zero would bury a control the scope has simply not simulated yet.
 */
export const buildPlanCandidates = (
  capabilities: Array<PlanCandidateCapability>,
  moves: Array<PlanCandidateMove>,
  leverRows: Array<PlanLeverRow>,
  postureByCapability: ReadonlyMap<string, PlanCandidatePosture>,
): Array<PlanCandidate> => {
  const moveByCapability = new Map(moves.map((move) => [move.capabilityId, move]));
  const gainsByControl = sumLevers(leverRows);

  return capabilities
    .map((capability) => {
      const move = moveByCapability.get(capability.id);
      const gains = gainsByControl.get(capability.id) ?? NO_GAINS;
      const posture = postureByCapability.get(capability.id);
      const currentStrengthRung = posture?.strengthRung ?? DEFAULT_STRENGTH_RUNG;
      const currentCoverageBucket = posture?.coverageBucket ?? DEFAULT_COVERAGE_BUCKET;
      return {
        capabilityId: capability.id,
        externalId: capability.externalId,
        name: capability.name,
        currentStrengthRung,
        currentCoverageBucket,
        targetStrengthRung: move?.targetStrengthRung ?? null,
        targetCoverageBucket: move?.targetCoverageBucket ?? null,
        inPlan: move !== undefined,
        ...gains,
      };
    })
    .sort((a, b) =>
      (bestLever(b) ?? -1) - (bestLever(a) ?? -1)
      || a.name.localeCompare(b.name)
      || a.capabilityId.localeCompare(b.capabilityId));
};
