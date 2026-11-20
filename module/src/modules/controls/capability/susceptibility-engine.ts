import type { CapabilityFunction, CoverageBucket, StrengthReferenceRung, StrengthRung } from './constants';
import { coverageCoefficient, ENGINE_SCORING_FUNCTIONS, STRENGTH_BY_RUNG, SUSCEPTIBILITY_GAMMA } from './constants';

// ─── Engine inputs (decoupled from the DB; built by the repository) ─────────────

/** One adjudicated coverage edge: a capability acts on a technique via a function. */
export interface CapabilityEdgeInput {
  capabilityId: string,
  /** MITRE technique uuid the edge targets. */
  techniqueId: string,
  function: CapabilityFunction,
}

/** The tenant's declared state of a capability (absent assessment = L0 / L0). */
export interface CapabilityStateInput {
  capabilityId: string,
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
}

/** A technique node in the scenario, with its parent (ATT&CK is at most 2 levels deep). */
export interface ScenarioNodeInput {
  techniqueId: string,
  parentTechniqueId: string | null,
}

/** Everything the susceptibility engine needs to score one scenario, for one tenant. */
export interface CapabilityResistanceInputs {
  nodes: Array<ScenarioNodeInput>,
  edges: Array<CapabilityEdgeInput>,
  states: Array<CapabilityStateInput>,
}

export interface SusceptibilityOptions {
  /** Noisy-OR diminishing-returns factor (default 0.7). */
  gamma?: number,
  /**
   * CVE-stock triplet hook: known-vuln findings raise susceptibility of
   * exploitation techniques directly on (S, t, P), lowering the resistance mu(t). Inert
   * until CVE-module (V0) findings exist. Value in [0,1] per technique uuid.
   */
  cveSusceptibilityByTechnique?: ReadonlyMap<string, number>,
  /**
   * Share of the estate in scope each capability applies on, in [0,1], scaling its edge efficacy
   * before the noisy-OR. An absent map means full weight, so a caller that knows nothing of the
   * control x family relations scores exactly as before. In a present map, a capability without an
   * entry scores zero: the builder emits an explicit entry for every capability it knows, so a
   * missing key is missing data, and defaulting it to full weight would silently inflate
   * resistance with no runtime signal.
   *
   * The map's grain belongs to the caller: the finding score gates each run on the family of the
   * asset the finding sits on, while the CRQ engine spreads over the scenario's estate as an
   * approximation of the per-step family filter the simulation engine will hold per technique and
   * family. The two answer the same question at different grains and are expected to disagree.
   */
  familyShareByCapability?: ReadonlyMap<string, number>,
  /** The edge functions walked; defaults to `ENGINE_SCORING_FUNCTIONS`, which the CRQ engine scores. */
  functions?: ReadonlyArray<CapabilityFunction>,
}

// ─── Per-edge efficacy ─────────────────────────────────────────────────────────

const clampUnit = (value: number): number => Math.min(Math.max(value, 0), 1 - 1e-9);

/**
 * Per-edge efficacy at palier 0 (optimism hypothesis):
 *   e = STRENGTH_BY_RUNG[rung] * coverageCoeff(bucket)
 * Returns 0 when the capability is absent (L0 instantiates no edge).
 */
export const edgeEfficacy = (state: CapabilityStateInput): number => {
  if (state.strengthRung === 'L0') {
    return 0;
  }
  const rung = state.strengthRung;
  const e = STRENGTH_BY_RUNG[rung] * coverageCoefficient(state.coverageBucket);
  return clampUnit(e);
};

// ─── Noisy-OR with diminishing returns ─────────────────────────────────────────

/**
 * P_f(t) = 1 - Π_i (1 - e_i · γ^(i-1)), efficacies sorted descending.
 * Stacking controls never yields P≈1.
 */
export const noisyOr = (efficacies: ReadonlyArray<number>, gamma: number = SUSCEPTIBILITY_GAMMA): number => {
  const sorted = [...efficacies].filter((e) => e > 0).sort((a, b) => b - a);
  let product = 1;
  for (let i = 0; i < sorted.length; i++) {
    product *= 1 - sorted[i] * gamma ** i;
  }
  return 1 - product;
};

// ─── Sub-technique grain: most-specific-wins, parent fallback ───────────────────

/**
 * For a scenario node and a capability+function, decide whether the single most-specific
 * edge on the path (the node itself, else its parent) exists. Returns its efficacy, or 0
 * if the capability covers neither.
 */
const contributionFor = (
  node: ScenarioNodeInput,
  edgesByCapTechFn: Map<string, CapabilityEdgeInput>,
  capabilityId: string,
  fn: CapabilityFunction,
  state: CapabilityStateInput,
): number => {
  const covers = edgesByCapTechFn.has(`${capabilityId}:${node.techniqueId}:${fn}`)
    || (node.parentTechniqueId !== null && edgesByCapTechFn.has(`${capabilityId}:${node.parentTechniqueId}:${fn}`));
  return covers ? edgeEfficacy(state) : 0;
};

// ─── Top-level: per-technique resistance mu(t) ─────────────────────────────────

/**
 * State-independent edge index: `capability:technique:function -> edge` for O(1) most-specific
 * lookup, plus the list of capabilities that carry at least one edge. It depends only on the
 * edge topology, so it can be built once and reused across many capability-state variations
 * (e.g. per-candidate what-if runs), avoiding an O(E) rebuild on each call.
 */
export interface ResistanceEdgeIndex {
  edgesByCapTechFn: Map<string, CapabilityEdgeInput>,
  capabilityIdsWithEdges: Array<string>,
}

export const buildResistanceEdgeIndex = (edges: ReadonlyArray<CapabilityEdgeInput>): ResistanceEdgeIndex => {
  const edgesByCapTechFn = new Map<string, CapabilityEdgeInput>();
  const capabilityIds = new Set<string>();
  for (const edge of edges) {
    edgesByCapTechFn.set(`${edge.capabilityId}:${edge.techniqueId}:${edge.function}`, edge);
    capabilityIds.add(edge.capabilityId);
  }
  return { edgesByCapTechFn, capabilityIdsWithEdges: [...capabilityIds] };
};

/**
 * Compute the per-technique resistance mu(t) against a prebuilt {@link ResistanceEdgeIndex}.
 * Same math as {@link computeTechniqueResistance}; the index is passed in so
 * repeated calls over varying states do not rebuild it.
 */
export const computeTechniqueResistanceWithIndex = (
  nodes: ReadonlyArray<ScenarioNodeInput>,
  index: ResistanceEdgeIndex,
  states: ReadonlyArray<CapabilityStateInput>,
  options: SusceptibilityOptions = {},
): Map<string, number> => {
  const gamma = options.gamma ?? SUSCEPTIBILITY_GAMMA;
  const cveByTechnique = options.cveSusceptibilityByTechnique;
  const familyShare = options.familyShareByCapability;
  const functions = options.functions ?? ENGINE_SCORING_FUNCTIONS;

  // Only capabilities with a declared state above L0 can contribute.
  const stateByCapability = new Map(states.filter((s) => s.strengthRung !== 'L0').map((s) => [s.capabilityId, s]));

  const result = new Map<string, number>();
  for (const node of nodes) {
    let blockComplement = 1; // Π_f (1 - P_f(t))
    for (const fn of functions) {
      const efficacies: Array<number> = [];
      for (const capabilityId of index.capabilityIdsWithEdges) {
        const state = stateByCapability.get(capabilityId);
        if (!state) {
          continue; // capability absent (L0) or without a declared state → no contribution
        }
        const familyWeight = familyShare === undefined ? 1 : (familyShare.get(capabilityId) ?? 0);
        const e = contributionFor(node, index.edgesByCapTechFn, capabilityId, fn, state) * familyWeight;
        if (e > 0) {
          efficacies.push(e);
        }
      }
      if (efficacies.length > 0) {
        blockComplement *= 1 - noisyOr(efficacies, gamma);
      }
    }
    let mu = 1 - blockComplement;
    const cve = cveByTechnique?.get(node.techniqueId);
    if (cve && cve > 0) {
      mu *= 1 - Math.min(cve, 1);
    }
    result.set(node.techniqueId, mu);
  }
  return result;
};

// ─── The same resistance, term by term ─────────────────────────────────────────

/** One control's part in a technique's resistance, as the noisy-OR credited it. */
export interface ControlContribution {
  capabilityId: string,
  strengthRung: StrengthReferenceRung,
  coverageBucket: CoverageBucket,
  /** Share of the scope this capability applies on, which scales its efficacy before the ranking. */
  familyWeight: number,
  efficacy: number,
  /** Rank once sorted by efficacy, zero-based, which is the power gamma is raised to. */
  rank: number,
  /** `efficacy x gamma^rank`: what the product actually received, not what the control is worth. */
  credited: number,
}

/**
 * One technique's resistance with every term it was built from.
 *
 * It restates the arithmetic of `computeTechniqueResistanceWithIndex` rather than riding along
 * with it, so the hot path over a whole estate keeps returning numbers alone. The unit test
 * asserting `resistance` equals the engine's mu on the same inputs is what keeps the two together.
 */
export interface TechniqueResistanceTerms {
  techniqueId: string,
  /** The per-edge strength at the reference rung L2, before coverage narrows it. */
  base: number,
  gamma: number,
  /** Every contributing control, strongest first. Empty when nothing stands on the technique. */
  contributions: Array<ControlContribution>,
  /** The product of what each credited control lets through. */
  letThrough: number,
  /** The CVE-stock multiplier the caller supplied for this technique; null when it supplied none. */
  cveSusceptibility: number | null,
  resistance: number,
}

/** The resistance of one technique, with the terms behind it, over the same functions as the figure. */
export const explainTechniqueResistance = (
  node: ScenarioNodeInput,
  index: ResistanceEdgeIndex,
  states: ReadonlyArray<CapabilityStateInput>,
  options: SusceptibilityOptions = {},
): TechniqueResistanceTerms => {
  const gamma = options.gamma ?? SUSCEPTIBILITY_GAMMA;
  const familyShare = options.familyShareByCapability;
  const cve = options.cveSusceptibilityByTechnique?.get(node.techniqueId);
  const functions = options.functions ?? ENGINE_SCORING_FUNCTIONS;
  // The predicate is what lets a contribution carry the reference rung: the engine's own filter
  // already guarantees it, but only a narrowing states it in the type.
  const above = (state: CapabilityStateInput): state is CapabilityStateInput & { strengthRung: StrengthReferenceRung } =>
    state.strengthRung !== 'L0';
  const stateByCapability = new Map(states.filter(above).map((s) => [s.capabilityId, s]));

  const scored: Array<Omit<ControlContribution, 'rank' | 'credited'>> = [];
  for (const fn of functions) {
    for (const capabilityId of index.capabilityIdsWithEdges) {
      const state = stateByCapability.get(capabilityId);
      if (!state) {
        continue;
      }
      const familyWeight = familyShare === undefined ? 1 : (familyShare.get(capabilityId) ?? 0);
      const efficacy = contributionFor(node, index.edgesByCapTechFn, capabilityId, fn, state) * familyWeight;
      if (efficacy > 0) {
        scored.push({
          capabilityId,
          strengthRung: state.strengthRung,
          coverageBucket: state.coverageBucket,
          familyWeight,
          efficacy,
        });
      }
    }
  }

  const contributions = scored
    .sort((a, b) => b.efficacy - a.efficacy)
    .map((contribution, rank) => ({ ...contribution, rank, credited: contribution.efficacy * gamma ** rank }));
  const letThrough = contributions.reduce((product, contribution) => product * (1 - contribution.credited), 1);
  // The engine lowers mu by the CVE stock after the noisy-OR, so a caller supplying the hook has to
  // see the same figure here or the explanation contradicts the score it explains.
  const applicable = cve !== undefined && cve > 0 ? Math.min(cve, 1) : null;

  return {
    techniqueId: node.techniqueId,
    base: STRENGTH_BY_RUNG.L2,
    gamma,
    contributions,
    letThrough,
    cveSusceptibility: applicable,
    resistance: applicable === null ? 1 - letThrough : (1 - letThrough) * (1 - applicable),
  };
};

/**
 * Compute the per-technique resistance mu(t) for each scenario node:
 * - per function f: noisy-OR of the contributing capabilities' efficacies;
 * - combine functions: P(t) = 1 - Π_f (1 - P_f(t));
 * - CVE-stock hook lowers mu(t) (inert at palier 0).
 * A node with no contribution maps to 0 (uncovered).
 */
export const computeTechniqueResistance = (
  nodes: ReadonlyArray<ScenarioNodeInput>,
  edges: ReadonlyArray<CapabilityEdgeInput>,
  states: ReadonlyArray<CapabilityStateInput>,
  options: SusceptibilityOptions = {},
): Map<string, number> =>
  computeTechniqueResistanceWithIndex(nodes, buildResistanceEdgeIndex(edges), states, options);
