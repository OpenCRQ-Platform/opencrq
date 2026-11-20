import type { CapabilityFunction, EffectiveEdgeSource, EffectiveEdgeState, TechniqueOverrideKind } from './constants';

/** A catalogue recommendation, one row of `control_capability_edges`. */
export interface CatalogueEdgeInput {
  capabilityId: string,
  techniqueId: string,
  function: CapabilityFunction,
}

/** One tenant overlay row on (control, technique, function): an addition or a removal. */
export interface TechniqueOverrideInput {
  capabilityId: string,
  techniqueId: string,
  kind: TechniqueOverrideKind,
  function: CapabilityFunction,
}

/**
 * One resolved coverage edge. `removed` rows stay in the list so the control keeps showing
 * what the catalogue recommends and what the tenant took out; they are not part of the
 * scored set (see {@link isScoredEdge}).
 */
export interface EffectiveEdge {
  capabilityId: string,
  techniqueId: string,
  function: CapabilityFunction,
  source: EffectiveEdgeSource,
  state: EffectiveEdgeState,
}

const key = (capabilityId: string, techniqueId: string, fn: CapabilityFunction): string =>
  `${capabilityId}:${techniqueId}:${fn}`;

/**
 * Effective coverage = catalogue edges − tenant removals + tenant additions. Every consumer
 * resolves coverage here, so the catalogue and the tenant's edits are never combined twice.
 *
 * A removal suppresses the single (technique, function) it names, and the suppressed row is
 * returned flagged `removed`, so a technique the catalogue recommends for both functions keeps
 * the other one. An addition contributes its single function; where the catalogue already
 * recommends that same (technique, function), the catalogue wins and the row reports
 * `source: 'catalogue'`, so a catalogue update that starts recommending an added technique
 * never yields a duplicate.
 */
export const resolveEffectiveEdges = (
  catalogueEdges: ReadonlyArray<CatalogueEdgeInput>,
  overrides: ReadonlyArray<TechniqueOverrideInput>,
): Array<EffectiveEdge> => {
  const removedEdges = new Set(
    overrides.filter((o) => o.kind === 'removed').map((o) => key(o.capabilityId, o.techniqueId, o.function)),
  );

  const resolved: Array<EffectiveEdge> = [];
  const emitted = new Set<string>();

  for (const edge of catalogueEdges) {
    const edgeKey = key(edge.capabilityId, edge.techniqueId, edge.function);
    if (emitted.has(edgeKey)) {
      continue;
    }
    emitted.add(edgeKey);
    resolved.push({
      capabilityId: edge.capabilityId,
      techniqueId: edge.techniqueId,
      function: edge.function,
      source: 'catalogue',
      state: removedEdges.has(edgeKey) ? 'removed' : 'recommended',
    });
  }

  for (const override of overrides) {
    if (override.kind !== 'added') {
      continue;
    }
    const edgeKey = key(override.capabilityId, override.techniqueId, override.function);
    if (emitted.has(edgeKey)) {
      continue; // the catalogue now recommends it too: catalogue wins on the duplicated function
    }
    emitted.add(edgeKey);
    resolved.push({
      capabilityId: override.capabilityId,
      techniqueId: override.techniqueId,
      function: override.function,
      source: 'tenant',
      state: 'added',
    });
  }

  return resolved;
};

/** The subset the engine scores: everything the tenant has not removed. */
export const isScoredEdge = (edge: Pick<EffectiveEdge, 'state'>): boolean => edge.state !== 'removed';

/**
 * A scored edge outranks a removed one whatever its grain, and the direct grain breaks the tie.
 * Scoring first is what keeps the survivor the edge the engine scores: a tenant removing a
 * recommendation at the sub-technique grain does not take away the one its parent still carries.
 */
const edgeRank = (edge: EffectiveEdge, techniqueId: string): number =>
  (isScoredEdge(edge) ? 2 : 0) + (edge.techniqueId === techniqueId ? 1 : 0);

/**
 * Collapses edges resolved over a sub-technique and its parent onto one per (control, function),
 * keeping the one the engine's parent fallback scores for that sub-technique.
 */
export const preferDirectEdges = (
  edges: ReadonlyArray<EffectiveEdge>,
  techniqueId: string,
): Array<EffectiveEdge> => {
  const kept = new Map<string, EffectiveEdge>();
  for (const edge of edges) {
    const behaviour = `${edge.capabilityId}:${edge.function}`;
    const current = kept.get(behaviour);
    if (current === undefined || edgeRank(edge, techniqueId) > edgeRank(current, techniqueId)) {
      kept.set(behaviour, edge);
    }
  }
  return [...kept.values()];
};
