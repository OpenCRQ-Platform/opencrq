import { deriveSeedId } from '../../seed-ids';
import { BUSINESS_VALUE_CATEGORIES } from './data/business-value-categories-data';

/**
 * The inverse of `deriveSeedId(tenantId, catalogueBusinessValueCategoryId)`: which catalog category
 * a stored tenant row id came from. A caller feeding a primary asset's real
 * `business_value_category_id` into `deriveEstimates` needs this — the kernel's own activation
 * matrix is keyed by catalogue id, never by a tenant's row id.
 */
export const resolveCatalogueBusinessValueCategoryId = (tenantId: string, tenantBusinessValueCategoryId: string): string | undefined =>
  BUSINESS_VALUE_CATEGORIES.find((category) => deriveSeedId(tenantId, category.id) === tenantBusinessValueCategoryId)?.id;
