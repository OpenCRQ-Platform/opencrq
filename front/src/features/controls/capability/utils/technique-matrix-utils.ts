import { CAPABILITY_FUNCTIONS } from '@app/module/client';
import type { CapabilityFunction } from '@app/module/client';
import type { CapabilityEdge } from '../types/capability';
import type { TileTone } from '../../../../components/shared/tile-tone';
import type { HighlightColor } from '../../../../components/shared/ttp-matrix-cell';

// Functions are categorical and each get a distinct hue, drawn from the four highlight hues
// supported by the shared TTP matrix cell. The hue confirms which surface the reader is on:
// every cell of a function tab shares it.
export const FUNCTION_COLOR: Record<CapabilityFunction, HighlightColor> = {
  prevent: 'blue',
  detect: 'orange',
};

/** The same hues on an icon tile, through the design system's feedback families rather than Tailwind's palette. */
export const FUNCTION_TILE_TONE: Record<CapabilityFunction, TileTone> = {
  prevent: 'info',
  detect: 'high',
};

// Canonical catalogue order (prevent -> detect), used to order every function list.
export const FUNCTION_PRIORITY: ReadonlyArray<CapabilityFunction> = CAPABILITY_FUNCTIONS;

export interface AggregatedTechnique {
  techniqueId: string,
  techniqueExternalId: string,
  techniqueName: string,
  edges: Array<Pick<CapabilityEdge, 'function' | 'state' | 'tactics'>>,
}

export const aggregateByTechnique = (edges: Array<CapabilityEdge>): Array<AggregatedTechnique> => {
  const byTechnique = new Map<string, AggregatedTechnique>();
  for (const edge of edges) {
    const existing = byTechnique.get(edge.techniqueId);
    if (existing) {
      existing.edges.push({ function: edge.function, state: edge.state, tactics: edge.tactics });
    } else {
      byTechnique.set(edge.techniqueId, {
        techniqueId: edge.techniqueId,
        techniqueExternalId: edge.techniqueExternalId,
        techniqueName: edge.techniqueName,
        edges: [{ function: edge.function, state: edge.state, tactics: edge.tactics }],
      });
    }
  }
  return [...byTechnique.values()];
};

/**
 * Functions the technique is still covered on, in catalogue order. A removed edge covers
 * nothing, so it neither colours the cell nor counts.
 */
export const activeFunctions = (technique: AggregatedTechnique): Array<CapabilityFunction> =>
  FUNCTION_PRIORITY.filter(
    (fn) => technique.edges.some((edge) => edge.function === fn && edge.state !== 'removed'),
  );

/** Techniques this function still covers, catalogue recommendations and tenant additions alike. */
export const coveredTechniquesForFunction = (
  edges: Array<CapabilityEdge>,
  capabilityFunction: CapabilityFunction,
): Array<AggregatedTechnique> =>
  aggregateByTechnique(edges.filter((edge) => edge.function === capabilityFunction))
    .filter((technique) => activeFunctions(technique).includes(capabilityFunction));
