import { asc, eq } from 'drizzle-orm';
import { defineRepository } from '../../registry';

export const businessValueCategoriesRepository = defineRepository({
  findAllBusinessValueCategories: ({ db, views }) => db
    .select()
    .from(views.businessValueCategories)
    .orderBy(asc(views.businessValueCategories.displayOrder)),
  findBusinessValueCategoryById: async ({ db, views }, id: string) =>
    (await db.select().from(views.businessValueCategories).where(eq(views.businessValueCategories.id, id)).limit(1)).at(0),
});
