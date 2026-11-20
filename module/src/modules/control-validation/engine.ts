import type { CapabilityFunction } from '../controls/capability/constants';
import type { EffectiveEdge } from '../controls/capability/effective-coverage';
import type { MeasuredValidityPolicy, MeasuredVerdict } from '../finding-score/engine';
import type { ExpectationType } from '../supporting-assets/constants';
import type { EvidenceState } from '../supporting-assets/schema';
import type { ValidationState } from './constants';
import { isScoredEdge } from '../controls/capability/effective-coverage';
import { isFreshMeasurement, resolveMeasuredResult } from '../finding-score/engine';
import { EXPECTATION_TYPE_TO_FUNCTION } from './constants';

// ─── Inputs (flat: no Drizzle, no service, no IO) ──────────────────────────────

/** What a simulation proved on one asset: one `asset_evidence` row plus its latest logged verdict. */
export interface ValidationEvidenceRow {
  supportingAssetId: string,
  mitreTechniqueId: string,
  /** Parent of the tested technique, which carries the fallback cell when no exact edge exists. */
  parentTechniqueId: string | null,
  expectationType: ExpectationType,
  /** The platform family that ran the test; an unmatched key reaches no control. */
  securityPlatformType: string | null,
  sourceScenarioId: string | null,
  sourceSimulationId: string | null,
  evaluatedAt: Date | null,
  /** The finding's latest logged test verdict; a person's decision is never one. */
  runVerdict: EvidenceState | null,
  runAt: Date | null,
}

/**
 * The results that agree on everything a vote reads but their asset, as one: the worst verdict and
 * the latest measurement among them, each fresh.
 */
export interface FoldedValidationResults extends Omit<ValidationEvidenceRow, 'supportingAssetId' | 'evaluatedAt' | 'runAt'> {
  /** The latest measurement date among the results, each the later of its evaluation and its verdict. */
  evaluatedAt: Date | null,
  /** Already folded into {@link evaluatedAt}. */
  runAt: null,
}

export type ValidationResult = ValidationEvidenceRow | FoldedValidationResults;

/** One (family, control) pair of the platform reference mapping. */
export interface PlatformFamilyControl {
  platformTypeKey: string,
  capabilityId: string,
}

export interface ValidationDerivationInput<Row extends ValidationResult = ValidationResult> {
  rows: ReadonlyArray<Row>,
  /** Effective coverage of every control a row could reach; `removed` edges are dropped here. */
  edges: ReadonlyArray<EffectiveEdge>,
  platformControls: ReadonlyArray<PlatformFamilyControl>,
  /** External id of every technique an edge can name, the parent techniques included. */
  techniqueExternalIds: ReadonlyMap<string, string>,
}

export interface ValidationDerivationContext {
  policy: MeasuredValidityPolicy,
  now: Date,
}

// ─── Outputs ───────────────────────────────────────────────────────────────────

/** A verdict a measurement can carry. `never_tested` is the absence of one, never a verdict. */
export type ProvenVerdict = Exclude<ValidationState, 'never_tested'>;

export interface ValidationCell {
  techniqueId: string,
  techniqueExternalId: string,
  function: CapabilityFunction,
  state: ValidationState,
  validatedVotes: number,
  totalVotes: number,
  /** Latest counted measurement on this cell; null when no counted row carried a date. */
  latestProofAt: Date | null,
}

export interface ControlValidationSummary {
  validatedTechniques: number,
  contradictedTechniques: number,
  testedTechniques: number,
  latestProofAt: Date | null,
}

export interface ControlValidation {
  capabilityId: string,
  state: ValidationState,
  summary: ControlValidationSummary,
  /** Cells with no vote are omitted: a missing cell reads as never tested. */
  cells: Array<ValidationCell>,
}

// ─── Derivation ────────────────────────────────────────────────────────────────

/**
 * Vote key of a row that names no scenario: its simulation, and only a row naming neither falls
 * into the shared bucket.
 *
 * Two distinct one-off simulations are two tests. Merging them into a single worst-of vote lets one
 * failure erase nine successes, which is the whole-control defect this derivation exists to undo,
 * reappearing one level down at the vote. Grouping by simulation never over-splits either: rows of
 * one simulation still share a key.
 */
const UNSCOPED_RUN = '';

const voteKeyOf = (row: ValidationResult): string =>
  row.sourceScenarioId ?? row.sourceSimulationId ?? UNSCOPED_RUN;

const SEVERITY: Record<ProvenVerdict, number> = { validated: 0, contradicted: 1 };

const provenVerdictOf = (verdict: MeasuredVerdict): ProvenVerdict => (verdict === 'got_through' ? 'contradicted' : 'validated');

const worstVerdict = (left: ProvenVerdict, right: ProvenVerdict): ProvenVerdict =>
  (SEVERITY[right] > SEVERITY[left] ? right : left);

const laterDate = (left: Date | null, right: Date | null): Date | null => {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return right.getTime() > left.getTime() ? right : left;
};

const cellKey = (techniqueId: string, fn: CapabilityFunction): string => `${techniqueId}:${fn}`;

const edgeKey = (capabilityId: string, techniqueId: string, fn: CapabilityFunction): string =>
  `${capabilityId}:${techniqueId}:${fn}`;

interface CellAccumulator {
  techniqueId: string,
  function: CapabilityFunction,
  /** One entry per scenario: its vote is the worst verdict any of its rows carried. */
  scenarioVotes: Map<string, ProvenVerdict>,
  latestMeasuredAt: Date | null,
}

interface ControlAccumulator {
  cells: Map<string, CellAccumulator>,
  latestProofAt: Date | null,
}

export const indexPlatformControls = (
  platformControls: ReadonlyArray<PlatformFamilyControl>,
): Map<string, Array<string>> => {
  const index = new Map<string, Array<string>>();
  for (const { platformTypeKey, capabilityId } of platformControls) {
    const capabilityIds = index.get(platformTypeKey) ?? [];
    capabilityIds.push(capabilityId);
    index.set(platformTypeKey, capabilityIds);
  }
  return index;
};

/** Keyed for {@link resolveCellTechniqueId}, without the edges the tenant removed. */
export const indexScoredEdges = (edges: ReadonlyArray<EffectiveEdge>): ReadonlySet<string> => new Set(
  edges.filter(isScoredEdge).map((edge) => edgeKey(edge.capabilityId, edge.techniqueId, edge.function)),
);

/**
 * Which cell of a control a result lands in: the exact technique when the control covers it, its
 * parent when only the parent is covered, and no cell at all otherwise. The precedence mirrors the
 * susceptibility engine, so a sub-technique result never lands in two cells at once.
 */
export const resolveCellTechniqueId = (
  scoredEdges: ReadonlySet<string>,
  capabilityId: string,
  row: Pick<ValidationEvidenceRow, 'mitreTechniqueId' | 'parentTechniqueId'>,
  fn: CapabilityFunction,
): string | null => {
  if (scoredEdges.has(edgeKey(capabilityId, row.mitreTechniqueId, fn))) {
    return row.mitreTechniqueId;
  }
  if (row.parentTechniqueId !== null && scoredEdges.has(edgeKey(capabilityId, row.parentTechniqueId, fn))) {
    return row.parentTechniqueId;
  }
  return null;
};

const recordVote = (
  control: ControlAccumulator,
  row: ValidationResult,
  cell: { techniqueId: string, function: CapabilityFunction },
  verdict: ProvenVerdict,
  measuredAt: Date | null,
): void => {
  const key = cellKey(cell.techniqueId, cell.function);
  const accumulator = control.cells.get(key) ?? {
    techniqueId: cell.techniqueId,
    function: cell.function,
    scenarioVotes: new Map<string, ProvenVerdict>(),
    latestMeasuredAt: null,
  };
  control.cells.set(key, accumulator);
  accumulator.latestMeasuredAt = laterDate(accumulator.latestMeasuredAt, measuredAt);

  const scenarioKey = voteKeyOf(row);
  const previousVote = accumulator.scenarioVotes.get(scenarioKey);
  accumulator.scenarioVotes.set(
    scenarioKey,
    previousVote === undefined ? verdict : worstVerdict(previousVote, verdict),
  );

  control.latestProofAt = laterDate(control.latestProofAt, measuredAt);
};

const buildCell = (accumulator: CellAccumulator, techniqueExternalId: string): ValidationCell => {
  const votes = [...accumulator.scenarioVotes.values()];
  const validatedVotes = votes.filter((vote) => vote === 'validated').length;
  return {
    techniqueId: accumulator.techniqueId,
    techniqueExternalId,
    function: accumulator.function,
    state: validatedVotes === votes.length ? 'validated' : 'contradicted',
    validatedVotes,
    totalVotes: votes.length,
    latestProofAt: accumulator.latestMeasuredAt,
  };
};

/** Worst-of across a technique's function cells, which is what the summary counts. */
const rollUpTechniqueStates = (cells: ReadonlyArray<ValidationCell>): Array<ValidationState> => {
  const byTechnique = new Map<string, ValidationState>();
  for (const cell of cells) {
    const previous = byTechnique.get(cell.techniqueId);
    byTechnique.set(
      cell.techniqueId,
      previous === 'contradicted' || cell.state === 'contradicted' ? 'contradicted' : cell.state,
    );
  }
  return [...byTechnique.values()];
};

/** One contradiction anywhere contradicts the control: a defence is judged on where it gave way. */
const resolveOverallState = (cells: ReadonlyArray<ValidationCell>): ValidationState => {
  if (cells.some((cell) => cell.state === 'contradicted')) {
    return 'contradicted';
  }
  return cells.length === 0 ? 'never_tested' : 'validated';
};

const buildControl = (
  capabilityId: string,
  accumulator: ControlAccumulator,
  techniqueExternalIds: ReadonlyMap<string, string>,
): ControlValidation => {
  const entries = [...accumulator.cells.values()]
    .map((cell) => ({ cell, externalId: techniqueExternalIds.get(cell.techniqueId) ?? cell.techniqueId }))
    .toSorted((left, right) =>
      left.externalId.localeCompare(right.externalId) || left.cell.function.localeCompare(right.cell.function));

  const cells = entries.map(({ cell, externalId }) => buildCell(cell, externalId));
  const techniqueStates = rollUpTechniqueStates(cells);

  return {
    capabilityId,
    state: resolveOverallState(cells),
    summary: {
      validatedTechniques: techniqueStates.filter((state) => state === 'validated').length,
      contradictedTechniques: techniqueStates.filter((state) => state === 'contradicted').length,
      testedTechniques: techniqueStates.length,
      latestProofAt: accumulator.latestProofAt,
    },
    cells,
  };
};

/**
 * What the simulations have actually proven, per control, per technique and function.
 *
 * Only a connector-written verdict is a measurement, and only inside the tenant's validity window:
 * an expired row leaves both sides of the ratio, so a cell whose every result has aged out reverts
 * to never tested rather than keeping the last thing it said. Controls nothing was attributed to
 * are absent from the result and are never tested by construction.
 */
export const deriveControlValidation = (
  input: ValidationDerivationInput,
  context: ValidationDerivationContext,
): Array<ControlValidation> => {
  const scoredEdges = indexScoredEdges(input.edges);
  const capabilitiesByPlatformType = indexPlatformControls(input.platformControls);
  const controls = new Map<string, ControlAccumulator>();

  for (const row of input.rows) {
    const measured = resolveMeasuredResult(row);
    if (measured === null || !isFreshMeasurement(measured, context.policy, context.now)) {
      continue;
    }
    const securityPlatformType = row.securityPlatformType;
    if (securityPlatformType === null) {
      continue;
    }
    const capabilityIds = capabilitiesByPlatformType.get(securityPlatformType);
    if (capabilityIds === undefined) {
      continue;
    }
    const fn = EXPECTATION_TYPE_TO_FUNCTION[row.expectationType];
    const verdict = provenVerdictOf(measured.verdict);

    for (const capabilityId of capabilityIds) {
      const techniqueId = resolveCellTechniqueId(scoredEdges, capabilityId, row, fn);
      if (techniqueId === null) {
        continue;
      }
      const control = controls.get(capabilityId) ?? { cells: new Map(), latestProofAt: null };
      controls.set(capabilityId, control);
      recordVote(control, row, { techniqueId, function: fn }, verdict, measured.measuredAt);
    }
  }

  return [...controls.entries()]
    .map(([capabilityId, accumulator]) => buildControl(capabilityId, accumulator, input.techniqueExternalIds))
    .toSorted((left, right) => left.capabilityId.localeCompare(right.capabilityId));
};
