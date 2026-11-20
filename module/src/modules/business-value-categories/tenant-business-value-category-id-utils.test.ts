import { describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { deriveSeedId } from '../../seed-ids';
import { BUSINESS_VALUE_CATEGORIES } from './data/business-value-categories-data';
import { BusinessValueCategory_PaymentCardData, BusinessValueCategory_PersonalData } from './data/business-value-categories-ids';
import { resolveCatalogueBusinessValueCategoryId } from './tenant-business-value-category-id-utils';

describe('resolveCatalogueBusinessValueCategoryId', () => {
  it('inverts deriveSeedId for every catalog category', () => {
    const tenantId = uuidv7();
    for (const category of BUSINESS_VALUE_CATEGORIES) {
      const tenantRowId = deriveSeedId(tenantId, category.id);
      expect(resolveCatalogueBusinessValueCategoryId(tenantId, tenantRowId)).toBe(category.id);
    }
  });

  it('differs per tenant for the same catalogue category', () => {
    const tenantAId = uuidv7();
    const tenantBId = uuidv7();
    const rowIdForA = deriveSeedId(tenantAId, BusinessValueCategory_PersonalData);
    expect(resolveCatalogueBusinessValueCategoryId(tenantBId, rowIdForA)).toBeUndefined();
    expect(resolveCatalogueBusinessValueCategoryId(tenantAId, rowIdForA)).toBe(BusinessValueCategory_PersonalData);
  });

  it('returns undefined for an id that is not a derived row of this tenant', () => {
    expect(resolveCatalogueBusinessValueCategoryId(uuidv7(), uuidv7())).toBeUndefined();
  });

  it('resolves a different category to a different catalogue id', () => {
    const tenantId = uuidv7();
    expect(resolveCatalogueBusinessValueCategoryId(tenantId, deriveSeedId(tenantId, BusinessValueCategory_PaymentCardData)))
      .toBe(BusinessValueCategory_PaymentCardData);
  });
});
