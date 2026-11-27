import type { SyncedMarkingDefinition } from './service';
import type { markingDefinitions } from './schema';
import { knownMarkingRank } from './default-markings';
import { isMarkingStixId } from './marking-stix-id';

/**
 * The rows a peer's markings are written as. An entry whose id is not a STIX marking id, or that
 * lacks a type or a definition, is skipped and counted; a marking stated twice keeps its last
 * occurrence. The rank is the one OpenCTI gives a marking it ships, else the one the peer states,
 * else none: a marking without a rank is unranked, not rank 0.
 */
export const markingRowsToSync = (
  tenantId: string,
  markings: ReadonlyArray<SyncedMarkingDefinition>,
  newId: () => string,
): { rows: Array<typeof markingDefinitions.$inferInsert>, skipped: number } => {
  const valid = markings.flatMap((marking) => {
    const definitionType = marking.definitionType.trim();
    const definition = marking.definition.trim();
    if (!isMarkingStixId(marking.stixId) || definitionType.length === 0 || definition.length === 0) {
      return [];
    }
    return [{
      id: newId(),
      tenantId,
      stixId: marking.stixId,
      definitionType,
      definition,
      color: marking.color ?? null,
      order: knownMarkingRank(marking.stixId) ?? (marking.order !== null && Number.isInteger(marking.order) ? marking.order : null),
    }];
  });
  return { rows: [...new Map(valid.map((row) => [row.stixId, row])).values()], skipped: markings.length - valid.length };
};
