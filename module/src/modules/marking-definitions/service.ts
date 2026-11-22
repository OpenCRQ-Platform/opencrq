import { newError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import { defineService } from '../../registry';
import { requireTenantId } from '../../security';
import { markingStixId } from './marking-stix-id';
import { markingDefinitionsRepository } from './repository';

export interface MarkingDefinitionInput {
  readonly definitionType: string,
  readonly definition: string,
  readonly color?: string | null,
  readonly order?: number,
}

/**
 * The marking definitions of a tenant and the clearance of its groups (CTEM marking parity, G2,
 * slice 3). A marking is created under the STIX id OpenCTI derives from its type and definition, so
 * the same marking created here, in OpenCTI or in OpenAEV is one object; creating one that already
 * exists answers its id and changes nothing.
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
      order: input.order ?? 0,
    });
    return { id, stixId, created: true };
  },
  updateMarkingDefinition: async ({ repo }, id: string, values: { color?: string | null, order?: number }) => {
    await repo.updateMarkingDefinition(id, values);
  },
  deleteMarkingDefinition: async ({ repo }, id: string) => {
    await repo.deleteMarkingDefinition(id);
  },
  getGroupMarkings: async ({ repo }, groupId: string) => await repo.findGroupMarkings(groupId),
  addMarkingToGroup: async ({ repo, eventOrigin }, groupId: string, markingDefinitionId: string) => {
    await repo.addGroupMarking(requireTenantId(eventOrigin), groupId, markingDefinitionId);
  },
  removeMarkingFromGroup: async ({ repo }, groupId: string, markingDefinitionId: string) => {
    await repo.removeGroupMarking(groupId, markingDefinitionId);
  },
});
