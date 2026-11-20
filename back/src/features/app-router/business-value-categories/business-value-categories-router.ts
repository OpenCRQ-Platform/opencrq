import { businessValueCategories } from '@app/module';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';

const BusinessValueCategorySchema = createSelectSchema(businessValueCategories).omit({ tenantId: true });

/** Closed catalog: the business-value categories are seeded, never tenant-authored. */
export const businessValueCategoriesRouter = (procedure: TenantProcedure) => router({
  // bounded-by: the business-value category catalogue, 10 rows seeded into every tenant
  getBusinessValueCategories: procedure
    .output(z.array(BusinessValueCategorySchema.pick({ id: true, code: true, name: true, description: true, displayOrder: true })))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .businessValueCategories.getBusinessValueCategories()),
  getBusinessValueCategory: procedure
    .input(z.object({ id: z.uuid() }))
    .output(BusinessValueCategorySchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => await services.withOrigin(origin)
      .businessValueCategories.getBusinessValueCategory(input.id) ?? null),
});
