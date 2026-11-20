import { defineRepository } from '../../registry';

export const sectorsRepository = defineRepository({
  findAllSectors: ({ db, views }) => db.select().from(views.sectors),
});
