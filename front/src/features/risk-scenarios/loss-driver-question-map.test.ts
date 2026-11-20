import { BUSINESS_VALUE_CATEGORIES, LOSS_DRIVERS } from '@app/module/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FINANCIAL_PROFILE_ANSWERS } from '../financial-profiles/financial-profile-schema';
import {
  getRecommendedButUnderivedDrivers,
  isDominantLossDriverNeedingInput,
  LOSS_DRIVER_QUESTION_MAP,
  NEVER_DERIVED_DRIVER_NAME,
  PROPRIETARY_INFORMATION_CODE,
} from './loss-driver-question-map';

describe('LOSS_DRIVER_QUESTION_MAP', () => {
  it('carries exactly one entry per catalog driver, the never-derived driver excepted', () => {
    const expectedNames = LOSS_DRIVERS
      .map((driver) => driver.name)
      .filter((name) => name !== NEVER_DERIVED_DRIVER_NAME)
      .sort();
    expect(Object.keys(LOSS_DRIVER_QUESTION_MAP).sort()).toEqual(expectedNames);
  });

  it('never carries an entry for the never-derived Hardware & equipment replacement driver', () => {
    expect(LOSS_DRIVER_QUESTION_MAP[NEVER_DERIVED_DRIVER_NAME]).toBeUndefined();
  });

  it('carries the dominant-loss-driver entry for Competitive-advantage erosion', () => {
    expect(LOSS_DRIVER_QUESTION_MAP['Competitive-advantage erosion']).toEqual(['Q14']);
  });

  it.each([
    'Forensics & incident management',
    'Internal response surge labor',
    'System & data restoration',
    'Extortion payment',
    'Contractual penalties & service credits',
  ])('lists Q1 for %s, whose formula also reads annualRevenueUsd', (name) => {
    expect(LOSS_DRIVER_QUESTION_MAP[name]).toContain('Q1');
  });

  it('does not name Q7 for Contractual penalties & service credits: the restore band is optional in that formula', () => {
    expect(LOSS_DRIVER_QUESTION_MAP['Contractual penalties & service credits']).not.toContain('Q7');
  });
});

describe('getRecommendedButUnderivedDrivers', () => {
  const recommendation = (lossDriverId: string, lossDriverName: string) => ({ lossDriverId, lossDriverName });

  it('lists a recommended driver absent from the priced estimates, paired with its unlocking question(s)', () => {
    const result = getRecommendedButUnderivedDrivers(
      [recommendation('d1', 'Stolen funds, net of recovery')],
      new Set(),
      null,
    );

    expect(result).toEqual([{ lossDriverId: 'd1', lossDriverName: 'Stolen funds, net of recovery', questionIds: ['Q13'] }]);
  });

  it('excludes a recommended driver already priced', () => {
    const result = getRecommendedButUnderivedDrivers(
      [recommendation('d1', 'Stolen funds, net of recovery')],
      new Set(['d1']),
      null,
    );

    expect(result).toEqual([]);
  });

  it('excludes Competitive-advantage erosion from the generic list even when missing', () => {
    const result = getRecommendedButUnderivedDrivers(
      [recommendation('d1', 'Competitive-advantage erosion')],
      new Set(),
      null,
    );

    expect(result).toEqual([]);
  });

  it('excludes Hardware & equipment replacement entirely, never reporting it as missing a card', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = getRecommendedButUnderivedDrivers(
      [recommendation('d1', 'Hardware & equipment replacement')],
      new Set(),
      null,
    );

    expect(result).toEqual([]);
    warnSpy.mockRestore();
  });

  it('pairs a multi-input driver with every question that feeds it', () => {
    const result = getRecommendedButUnderivedDrivers(
      [recommendation('d1', 'Incident legal counsel')],
      new Set(),
      null,
    );

    expect(result).toEqual([{ lossDriverId: 'd1', lossDriverName: 'Incident legal counsel', questionIds: ['Q9a', 'Q10'] }]);
  });

  describe('a recommended driver absent from the lookup map', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('excludes it and logs a warning naming the driver id and name', () => {
      const result = getRecommendedButUnderivedDrivers(
        [recommendation('d1', 'Some renamed catalog driver')],
        new Set(),
        null,
      );

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('d1');
      expect(warnSpy.mock.calls[0][0]).toContain('Some renamed catalog driver');
    });
  });

  describe('with the financial profile answers', () => {
    it('narrows the questions down to the ones not yet answered', () => {
      const result = getRecommendedButUnderivedDrivers(
        [recommendation('d1', 'Incident legal counsel')],
        new Set(),
        { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, regulatoryRegime: 'none' },
      );

      expect(result).toEqual([{ lossDriverId: 'd1', lossDriverName: 'Incident legal counsel', questionIds: ['Q9a'] }]);
    });

    it('excludes the driver entirely once every mapped question is answered', () => {
      const result = getRecommendedButUnderivedDrivers(
        [recommendation('d1', 'Stolen funds, net of recovery')],
        new Set(),
        { ...EMPTY_FINANCIAL_PROFILE_ANSWERS, paymentFlowDailyValueBand: 'under_100k' },
      );

      expect(result).toEqual([]);
    });
  });
});

describe('isDominantLossDriverNeedingInput', () => {
  const dominant = (viaCells: ReadonlyArray<{ businessValueCategoryCode: string }>) => (
    { lossDriverId: 'd8.2', lossDriverName: 'Competitive-advantage erosion', viaCells }
  );
  const other = (lossDriverId: string, viaCells: ReadonlyArray<{ businessValueCategoryCode: string }>) => (
    { lossDriverId, lossDriverName: 'Some other driver', viaCells }
  );
  const cell = (businessValueCategoryCode: string) => ({ businessValueCategoryCode });
  const c6 = () => cell(PROPRIETARY_INFORMATION_CODE);

  it('keys on a code the seeded catalogue actually carries', () => {
    // The whole point of reading `code` rather than the display name: this fails loudly the day
    // the catalogue drops or renames the resource, instead of the message quietly never firing.
    expect(BUSINESS_VALUE_CATEGORIES.map((category) => category.code)).toContain(PROPRIETARY_INFORMATION_CODE);
  });

  it('is true when the dominant driver is recommended via a C6 cell, not yet priced, and Q14 is unanswered', () => {
    expect(isDominantLossDriverNeedingInput(
      [dominant([c6()])],
      new Set(),
      null,
    )).toBe(true);
  });

  it('is false when C6 is active but Q14 is answered', () => {
    expect(isDominantLossDriverNeedingInput(
      [dominant([c6()])],
      new Set(),
      'under_2',
    )).toBe(false);
  });

  it('is false when the dominant driver is not recommended at all', () => {
    expect(isDominantLossDriverNeedingInput(
      [other('d1', [c6()])],
      new Set(),
      null,
    )).toBe(false);
  });

  it('is false when the dominant driver is recommended but already priced (present, manually or otherwise)', () => {
    expect(isDominantLossDriverNeedingInput(
      [dominant([c6()])],
      new Set(['d8.2']),
      null,
    )).toBe(false);
  });

  it('is false when the dominant driver\'s own cells never reach C6, even if another driver\'s cell does', () => {
    expect(isDominantLossDriverNeedingInput(
      [
        dominant([cell('personal-data')]),
        other('d1', [c6()]),
      ],
      new Set(),
      null,
    )).toBe(false);
  });

  it('is false when there are no recommendations at all', () => {
    expect(isDominantLossDriverNeedingInput([], new Set(), null)).toBe(false);
  });
});
