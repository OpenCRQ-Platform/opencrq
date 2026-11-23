import type { SyncedMarkingDefinition } from '@app/module';
import { isMarkingStixId, markingStixId } from '@app/module';
import type { OpenaevMarkingDefinition } from './openaev-types';

/**
 * The marking vocabulary OpenAEV serves the connector: the definitions it is cleared for, or the
 * reason it serves none (an OpenAEV without the route, an account refused it).
 */
export type OpenaevMarkingVocabulary =
  | { readonly available: true, readonly markings: ReadonlyArray<OpenaevMarkingDefinition> }
  | { readonly available: false, readonly reason: string };

/** What the marking phase reads from OpenAEV and writes to OpenCRQ, injected so it is tested without either. */
export interface OpenaevMarkingPhaseDeps {
  readonly listAssignableMarkingDefinitions: (openaevTenantId: string) => Promise<OpenaevMarkingVocabulary>,
  readonly syncMarkingDefinitions: (markings: ReadonlyArray<SyncedMarkingDefinition>) => Promise<{ synced: number, skipped: number }>,
  readonly warn: (message: string, data: Record<string, unknown>) => void,
  readonly signal: AbortSignal,
}

/**
 * The STIX id of an OpenAEV marking: the one OpenCTI gives it when OpenAEV holds it, else the one
 * OpenCTI derives from the type and the definition, so a TLP or PAP marking created in OpenAEV
 * alone is the same marking as in OpenCTI and OpenCRQ. Null when neither is usable.
 */
export const stixIdOfOpenaevMarking = (marking: OpenaevMarkingDefinition): string | null => {
  const stated = marking.marking_definition_stix_id?.trim();
  if (stated && isMarkingStixId(stated)) {
    return stated;
  }
  const type = marking.marking_definition_type.trim();
  const definition = marking.marking_definition_definition.trim();
  return type.length > 0 && definition.length > 0 ? markingStixId(type, definition) : null;
};

/**
 * Mirrors one OpenAEV tenant's marking definitions into the OpenCRQ tenant (CTEM marking parity,
 * G4), under their STIX ids, and answers the map from OpenAEV marking id to STIX id the inventory
 * translates `asset_markings` with. A marking already mirrored from OpenCTI is the same row (one
 * STIX id per tenant), so the clearance a group holds covers it whichever product reported it.
 *
 * The vocabulary is the list of definitions the connector is cleared for: it reads only the assets
 * whose markings it is cleared for, so that list names every `asset_markings` id it will see. When
 * OpenAEV serves no vocabulary, the phase warns and answers an empty map: the sync goes on, and an
 * asset whose marking id stays unresolved fails closed in the inventory.
 */
export const syncOpenaevMarkings = async (deps: OpenaevMarkingPhaseDeps, openaevTenantId: string): Promise<Map<string, string>> => {
  const stixIdByOpenaevId = new Map<string, string>();
  if (deps.signal.aborted) {
    return stixIdByOpenaevId;
  }
  const vocabulary = await deps.listAssignableMarkingDefinitions(openaevTenantId);
  if (!vocabulary.available) {
    deps.warn('OpenAEV marking definitions unavailable: assets keep their OpenAEV marking ids and fail closed', { openaevTenantId, reason: vocabulary.reason });
    return stixIdByOpenaevId;
  }
  const synced: Array<SyncedMarkingDefinition> = [];
  for (const marking of vocabulary.markings) {
    const stixId = stixIdOfOpenaevMarking(marking);
    if (stixId === null) {
      continue;
    }
    stixIdByOpenaevId.set(marking.marking_definition_id, stixId);
    synced.push({
      stixId,
      definitionType: marking.marking_definition_type,
      definition: marking.marking_definition_definition,
      color: marking.marking_definition_color ?? null,
      order: marking.marking_definition_order ?? 0,
    });
  }
  if (synced.length > 0 && !deps.signal.aborted) {
    await deps.syncMarkingDefinitions(synced);
  }
  return stixIdByOpenaevId;
};
