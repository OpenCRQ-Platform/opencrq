import { describe, expect, it } from 'vitest';
import * as categoryIds from './business-value-categories-ids';
import { BUSINESS_VALUE_CATEGORIES } from './business-value-categories-data';

// The catalog is closed reference data: every count below is pinned as a literal so that any edit
// to the seed source shows up as a reviewed diff in this file rather than passing silently.
const BUSINESS_VALUE_CATEGORY_COUNT = 10;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isNonEmpty = (value: string) => value.trim().length > 0;

describe('BUSINESS_VALUE_CATEGORIES', () => {
  it('holds the ten flat business resources, one per declared identifier', () => {
    expect(BUSINESS_VALUE_CATEGORIES).toHaveLength(BUSINESS_VALUE_CATEGORY_COUNT);
    // The ids file is sorted by name and the catalog by display order, so the guard is a set
    // comparison: it catches an id declared and never used, and an entry built on an inline UUID.
    expect(BUSINESS_VALUE_CATEGORIES.map((category) => category.id).toSorted())
      .toEqual(Object.values(categoryIds).toSorted());
  });

  it('gives every category non-empty labels and a contiguous display order', () => {
    for (const category of BUSINESS_VALUE_CATEGORIES) {
      expect(isNonEmpty(category.name)).toBe(true);
      expect(isNonEmpty(category.description)).toBe(true);
    }
    expect(BUSINESS_VALUE_CATEGORIES.map((category) => category.displayOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  // The frontend translates on the code alone, so a duplicate or a renamed one silently drops a
  // label back to the English name of the row.
  it('keys every entry on a distinct kebab-case code', () => {
    const codes = BUSINESS_VALUE_CATEGORIES.map((category) => category.code);
    expect(codes).toEqual([
      'operations-and-services',
      'services-under-commitments',
      'physical-assets-and-facilities',
      'personal-data',
      'payment-card-data',
      'proprietary-information',
      'data-entrusted-by-others',
      'own-funds-and-payment-authority',
      'funds-and-assets-held-for-others',
      'regulated-function-or-data',
    ]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('writes every identifier as a well-formed UUID', () => {
    for (const category of BUSINESS_VALUE_CATEGORIES) {
      expect(category.id).toMatch(UUID_PATTERN);
    }
  });
});
