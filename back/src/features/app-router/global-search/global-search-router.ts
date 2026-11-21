import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';

export const globalSearchRouter = (procedure: TenantProcedure) => router({
  // bounded-by: GLOBAL_SEARCH_LIMIT_PER_TYPE, the limit each read of globalSearch applies in SQL
  search: procedure
    .input(z.object({ search: z.string().trim().min(1).max(200) }))
    .query(({ input, ctx: { services, origin } }) =>
      services.withOrigin(origin).globalSearch.search(input.search)),
});
