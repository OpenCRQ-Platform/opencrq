import { defineService } from '../../registry';
import { sectorsRepository } from './repository';

export const sectorsService = defineService(
  'sectors',
  sectorsRepository,
).implement({
  getSectors: async ({ repo }) => await repo.findAllSectors(),
});
