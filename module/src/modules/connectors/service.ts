import { defineService } from '../../registry';
import { connectorsRepository } from './repository';

export const connectorsService = defineService(
  'connectors',
  connectorsRepository,
).implement({
  countIngestedRecords: async ({ repo }, tenantId: string) => repo.countIngestedRecords(tenantId),
});
