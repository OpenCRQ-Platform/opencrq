import { defineService } from '../../registry';
import { workersRepository } from './repository';

export const workersService = defineService(
  'workers',
  workersRepository,
).implement({
  heartbeat: async ({ repo }, id: string, processName: string) => repo.heartbeat(id, processName),

  isAnyWorkerAlive: async ({ repo }, staleAfterSeconds: number) => repo.isAnyWorkerAlive(staleAfterSeconds),
});
