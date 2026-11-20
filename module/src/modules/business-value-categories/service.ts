import { defineService } from '../../registry';
import { businessValueCategoriesRepository } from './repository';

/** Read-only catalog: the nine business-value categories are seeded, never tenant-authored. */
export const businessValueCategoriesService = defineService(
  'businessValueCategories',
  businessValueCategoriesRepository,
).implement({
  getBusinessValueCategories: async ({ repo }) => await repo.findAllBusinessValueCategories(),
  getBusinessValueCategory: async ({ repo }, id: string) => await repo.findBusinessValueCategoryById(id),
});
