import { defineService } from '../../registry';
import { mitreAttackRepository } from './repository';

export const mitreAttackService = defineService(
  'mitreAttack',
  mitreAttackRepository,
).implement({
  getTactics: async ({ repo }) => await repo.findAllTactics(),
  getTacticByExternalId: async ({ repo }, externalId: string) => await repo.findTacticByExternalId(externalId),
  getTechniques: async ({ repo }) => await repo.findAllTechniques(),
  getTechniqueByExternalId: async ({ repo }, externalId: string) => await repo.findTechniqueByExternalId(externalId),
  getMitigations: async ({ repo }) => await repo.findAllMitigations(),
  getMitigationByExternalId: async ({ repo }, externalId: string) => await repo.findMitigationByExternalId(externalId),
  getMatrix: async ({ repo }) => await repo.findMatrixData(),
  getTechniqueIdsByExternalIds: async ({ repo }, externalIds: Array<string>) =>
    repo.findTechniqueIdsByExternalIds(externalIds),
});
