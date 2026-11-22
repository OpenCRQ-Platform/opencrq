import type { SyncedMarkingDefinition } from '@app/module';
import { isMarkingStixId, markingStixId } from '@app/module';
import type { OpenaevMarkingDefinition } from './openaev-types';

/** What the marking phase reads from OpenAEV and writes to OpenCRQ, injected so it is tested without either. */
export interface OpenaevMarkingPhaseDeps {
  readonly searchMarkingDefinitions: (openaevTenantId: string, page: number) => Promise<{ content: Array<OpenaevMarkingDefinition>, last: boolean }>,
  readonly syncMarkingDefinitions: (markings: ReadonlyArray<SyncedMarkingDefinition>) => Promise<{ synced: number, skipped: number }>,
  readonly signal: AbortSignal,
}

/** Pages read at most per OpenAEV tenant: 100 definitions a page, far above any tenant's vocabulary. */
const MAX_PAGES = 50;

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
 */
export const syncOpenaevMarkings = async (deps: OpenaevMarkingPhaseDeps, openaevTenantId: string): Promise<Map<string, string>> => {
  const stixIdByOpenaevId = new Map<string, string>();
  const synced: Array<SyncedMarkingDefinition> = [];
  for (let page = 0; page < MAX_PAGES && !deps.signal.aborted; page++) {
    const { content, last } = await deps.searchMarkingDefinitions(openaevTenantId, page);
    for (const marking of content) {
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
    if (last || content.length === 0) {
      break;
    }
  }
  if (synced.length > 0 && !deps.signal.aborted) {
    await deps.syncMarkingDefinitions(synced);
  }
  return stixIdByOpenaevId;
};
