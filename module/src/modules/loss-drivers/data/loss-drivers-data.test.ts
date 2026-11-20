import { describe, expect, it } from 'vitest';
import { ATTACK_OUTCOMES } from '../../attack-outcomes/data';
import { BUSINESS_VALUE_CATEGORIES } from '../../business-value-categories/data';
import { DWELL_SENSITIVITY_VALUES, SCALING_VARIABLE_VALUES } from './loss-drivers-constants';
import {
  LossDriver_IdentityCreditProtection,
  LossDriver_NotificationCallHandling,
  LossDriver_PaymentCardAssessments,
  LossDriver_SettlementsDamages,
} from './loss-drivers-ids';
import * as lossIds from './loss-drivers-ids';
import { LOSS_CATEGORIES, LOSS_DRIVERS } from './loss-drivers-data';

// The catalog is closed reference data: every count below is pinned as a literal so that any edit
// to the seed source shows up as a reviewed diff in this file rather than passing silently.
const OUTCOME_COUNT = 7;
const BUSINESS_VALUE_CATEGORY_COUNT = 10;
const LOSS_CATEGORY_COUNT = 8;
const DRIVER_COUNT = 19;
const ENTRY_COUNT = OUTCOME_COUNT + BUSINESS_VALUE_CATEGORY_COUNT + LOSS_CATEGORY_COUNT + DRIVER_COUNT;

const STRONG_DWELL_COUNT = 6;
const WEAK_DWELL_COUNT = 1;
const NONE_DWELL_COUNT = 12;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isNonEmpty = (value: string) => value.trim().length > 0;

describe('LOSS_CATEGORIES', () => {
  it('holds the eight loss categories, one per declared identifier', () => {
    expect(LOSS_CATEGORIES).toHaveLength(LOSS_CATEGORY_COUNT);
    // The ids file is sorted by name and the catalog by display order, so the guard is a set
    // comparison: it catches an id declared and never used, and an entry built on an inline UUID.
    expect(LOSS_CATEGORIES.map((category) => category.id).toSorted())
      .toEqual(Object.entries(lossIds).filter(([key]) => key.startsWith('LossCategory_')).map(([, id]) => id).toSorted());
  });

  it('gives every loss category non-empty labels and a contiguous display order', () => {
    for (const category of LOSS_CATEGORIES) {
      expect(isNonEmpty(category.name)).toBe(true);
      expect(isNonEmpty(category.description)).toBe(true);
    }
    expect(LOSS_CATEGORIES.map((category) => category.displayOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('LOSS_DRIVERS', () => {
  it('holds the nineteen drivers, one per declared identifier', () => {
    expect(LOSS_DRIVERS).toHaveLength(DRIVER_COUNT);
    expect(LOSS_DRIVERS.map((driver) => driver.id).toSorted())
      .toEqual(Object.entries(lossIds).filter(([key]) => key.startsWith('LossDriver_')).map(([, id]) => id).toSorted());
  });

  it('gives every driver non-empty labels', () => {
    for (const driver of LOSS_DRIVERS) {
      expect(isNonEmpty(driver.name)).toBe(true);
      expect(isNonEmpty(driver.description)).toBe(true);
    }
  });

  it('ranks the drivers of a loss category from one, without a gap or a tie', () => {
    for (const category of LOSS_CATEGORIES) {
      const ranks = LOSS_DRIVERS
        .filter((driver) => driver.lossCategoryId === category.id)
        .map((driver) => driver.displayOrder);

      expect(ranks).toEqual(ranks.map((_, index) => index + 1));
    }
  });

  it('resolves every loss category reference', () => {
    const lossCategoryIds = new Set(LOSS_CATEGORIES.map((category) => category.id));

    for (const driver of LOSS_DRIVERS) {
      expect(lossCategoryIds.has(driver.lossCategoryId)).toBe(true);
    }
  });

  it('holds six strong, one weak and twelve none dwell sensitivities', () => {
    const countOf = (sensitivity: string) => LOSS_DRIVERS.filter((driver) => driver.dwellSensitivity === sensitivity).length;

    expect(countOf('strong')).toBe(STRONG_DWELL_COUNT);
    expect(countOf('weak')).toBe(WEAK_DWELL_COUNT);
    expect(countOf('none')).toBe(NONE_DWELL_COUNT);
  });

  it('draws every dwell sensitivity and scaling variable from its closed vocabulary', () => {
    for (const driver of LOSS_DRIVERS) {
      expect(DWELL_SENSITIVITY_VALUES).toContain(driver.dwellSensitivity);
      expect(SCALING_VARIABLE_VALUES).toContain(driver.scalingVariable);
    }
  });

  it('keeps the four drivers that deliberately share affected_record_count', () => {
    // The shared scaling variable is the key a later comonotone coupling uses to find exactly this
    // subset; splitting it loses that.
    const shared = LOSS_DRIVERS.filter((driver) => driver.scalingVariable === 'affected_record_count');

    expect(shared.map((driver) => driver.id)).toEqual([
      LossDriver_NotificationCallHandling,
      LossDriver_IdentityCreditProtection,
      LossDriver_SettlementsDamages,
      LossDriver_PaymentCardAssessments,
    ]);
  });

  // The key set is pinned so that adding an occurrence probability or an occurrence rate field to
  // a driver fails this test instead of passing review unnoticed.
  it('exposes exactly the expected keys on every driver entry', () => {
    for (const driver of LOSS_DRIVERS) {
      expect(Object.keys(driver).sort()).toEqual([
        'description',
        'displayOrder',
        'dwellSensitivity',
        'id',
        'lossCategoryId',
        'name',
        'scalingVariable',
      ]);
    }
  });

  it('writes every identifier as a well-formed UUID', () => {
    for (const driver of LOSS_DRIVERS) {
      expect(driver.id).toMatch(UUID_PATTERN);
    }
  });
});

describe('Loss model catalog identifiers', () => {
  const allIds = [
    ...ATTACK_OUTCOMES.map((entry) => entry.id),
    ...BUSINESS_VALUE_CATEGORIES.map((entry) => entry.id),
    ...LOSS_CATEGORIES.map((entry) => entry.id),
    ...LOSS_DRIVERS.map((entry) => entry.id),
  ];

  it('carries forty-four entry identifiers, unique across the four catalogs', () => {
    // One derivation covers the four catalogs, so a collision between any two entries would make
    // two catalog rows share a tenant row identifier.
    expect(allIds).toHaveLength(ENTRY_COUNT);
    expect(new Set(allIds).size).toBe(ENTRY_COUNT);
  });
});
