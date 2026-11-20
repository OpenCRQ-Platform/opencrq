import { sectors } from '@app/module';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';

const SectorsSchema = createSelectSchema(sectors).pick({ id: true, name: true, description: true });

export const sectorsRouter = (procedure: TenantProcedure) => router({
  // bounded-by: the sector catalogue, 22 rows seeded into every tenant
  getSectors: procedure
    .output(z.array(SectorsSchema))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .sectors.getSectors()),
});
