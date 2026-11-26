import { newError, StructuredError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import { defineService } from '../../registry';
import { requireTenantId } from '../../security';
import { isProtectedMarking, knownMarkingRank } from './default-markings';
import { markingStixId } from './marking-stix-id';
import { markingDefinitionsRepository } from './repository';
import { markingRowsToSync } from './sync-rows';

export interface MarkingDefinitionInput {
  readonly definitionType: string,
  readonly definition: string,
  readonly color?: string | null,
  readonly order?: number,
}

/** A marking as the tenant's OpenCTI defines it, under its STIX `standard_id`. */
export interface SyncedMarkingDefinition {
  readonly stixId: string,
  readonly definitionType: string,
  readonly definition: string,
  readonly color: string | null,
  /** `null` when the peer gave no rank. */
  readonly order: number | null,
}

/** A change of rank, or a deletion, of a default marking. */
export class ProtectedMarkingDefinitionError extends StructuredError {
  override readonly name: string = 'ProtectedMarkingDefinitionError';

  constructor() {
    super('A default marking cannot have its rank changed or be deleted', { data: {} });
  }
}

/** A marking the caller's tenant does not hold, or that the caller is not cleared for. */
export class MarkingDefinitionNotFoundError extends StructuredError {
  override readonly name: string = 'MarkingDefinitionNotFoundError';

  constructor() {
    super('Marking definition not found', { data: {} });
  }
}

/**
 * The marking definitions of a tenant and the clearance of its groups (CTEM marking parity, G2,
 * slice 3). A marking is created under the STIX id OpenCTI derives from its type and definition, so
 * the same marking created here, in OpenCTI or in OpenAEV is one object; creating one that already
 * exists answers its id and changes nothing. Deleting one declassifies the rows that carry it, as in
 * OpenAEV, and is refused for a default marking or one the caller is not cleared for.
 */
export const markingDefinitionsService = defineService('markingDefinitions', markingDefinitionsRepository).implement({
  listMarkingDefinitions: async ({ repo }) => await repo.findMarkingDefinitions(),
  createMarkingDefinition: async ({ repo, eventOrigin }, input: MarkingDefinitionInput) => {
    const definitionType = input.definitionType.trim();
    const definition = input.definition.trim();
    if (definitionType.length === 0 || definition.length === 0) {
      throw newError('A marking needs a type and a definition');
    }
    const stixId = markingStixId(definitionType, definition);
    const existing = await repo.findMarkingDefinitionByStixId(stixId);
    if (existing !== undefined) {
      return { id: existing.id, stixId, created: false };
    }
    const id = uuidv7();
    await repo.insertMarkingDefinition({
      id,
      tenantId: requireTenantId(eventOrigin),
      stixId,
      definitionType,
      definition,
      color: input.color ?? null,
      order: knownMarkingRank(stixId) ?? input.order ?? null,
    });
    return { id, stixId, created: true };
  },
  /**
   * Mirrors the marking definitions a peer defines (G2, slice 3b): each one under the STIX id the peer
   * states, with its type, definition, colour and rank, so a clearance in OpenCRQ names the same
   * markings the peer does. A marking the peer no longer lists is kept: a security manager may have
   * created it here, and rows may still carry it. An entry whose id is not a STIX marking id, or that
   * lacks a type or a definition, is skipped and counted. The rank follows `markingRowsToSync`, and
   * OpenCTI alone changes the rank of a marking already held (`upsertMarkingDefinitions`).
   */
  syncMarkingDefinitions: async ({ repo }, tenantId: string, markings: ReadonlyArray<SyncedMarkingDefinition>, source: 'opencti' | 'openaev') => {
    const { rows, skipped } = markingRowsToSync(tenantId, markings, uuidv7);
    if (rows.length > 0) {
      await repo.upsertMarkingDefinitions(rows, source);
    }
    return { synced: rows.length, skipped };
  },
  updateMarkingDefinition: async ({ repo }, id: string, values: { color?: string | null, order?: number }) => {
    if (values.order !== undefined) {
      const existing = await repo.findMarkingDefinitionById(id);
      if (existing !== undefined && isProtectedMarking(existing.stixId) && existing.order !== values.order) {
        throw new ProtectedMarkingDefinitionError();
      }
    }
    await repo.updateMarkingDefinition(id, values);
  },
  deleteMarkingDefinition: async ({ atomic, eventOrigin }, id: string) => {
    await atomic(async ({ repo }) => {
      const marking = await repo.findDeletableMarking(id, eventOrigin);
      if (marking === undefined) {
        throw new MarkingDefinitionNotFoundError();
      }
      if (isProtectedMarking(marking.stixId)) {
        throw new ProtectedMarkingDefinitionError();
      }
      if (!await repo.deleteMarkingDefinition(id)) {
        throw newError('Access Denied');
      }
      await repo.scrubMarkingRefs(requireTenantId(eventOrigin), marking.stixId);
    });
  },
  getGroupMarkings: async ({ repo }, groupId: string) => await repo.findGroupMarkings(groupId),
  addMarkingToGroup: async ({ repo, eventOrigin }, groupId: string, markingDefinitionId: string) => {
    await repo.addGroupMarking(requireTenantId(eventOrigin), groupId, markingDefinitionId);
  },
  removeMarkingFromGroup: async ({ repo }, groupId: string, markingDefinitionId: string) => {
    await repo.removeGroupMarking(groupId, markingDefinitionId);
  },
});
