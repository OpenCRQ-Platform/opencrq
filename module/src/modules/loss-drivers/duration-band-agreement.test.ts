import { describe, expect, it } from 'vitest';
import {
  FULL_RESTORE_BAND_VALUES,
  FULL_RESTORE_DAYS,
  TIME_TO_REVENUE_IMPACT_BAND_VALUES,
  TIME_TO_REVENUE_IMPACT_DAYS,
  WORST_OUTAGE_BAND_VALUES,
  WORST_OUTAGE_DAYS,
} from '../financial-profiles/constants';
import { KERNEL_WORST_OUTAGE_DAYS, RESTORE_DAYS_BY_BAND, TIME_TO_IMPACT_HOURS_BY_BAND } from './derive-estimates-helpers';
import { FULL_RESTORE_BAND_MAP, TIME_TO_REVENUE_IMPACT_BAND_MAP, WORST_OUTAGE_BAND_MAP } from './derive-estimates-input-mapping-utils';

const HOURS_PER_DAY = 24;

/**
 * The questionnaire and the kernel band the same three durations under two vocabularies, on
 * purpose: the kernel does not depend on the questionnaire's persistence format, and the mapping
 * layer is what joins them. Two vocabularies means two midpoint tables, and nothing but this
 * checks that they still say the same thing — the tables are written apart, so they can drift
 * apart. Walking the maps pins the values without merging the tables.
 */
describe('duration band midpoints agree across the two vocabularies', () => {
  it('Q6 time-to-impact: the kernel reads the same midpoint, in hours', () => {
    for (const band of TIME_TO_REVENUE_IMPACT_BAND_VALUES) {
      expect(TIME_TO_IMPACT_HOURS_BY_BAND[TIME_TO_REVENUE_IMPACT_BAND_MAP[band]] / HOURS_PER_DAY, band)
        .toBeCloseTo(TIME_TO_REVENUE_IMPACT_DAYS[band], 10);
    }
  });

  it('Q7 full restore: the kernel reads the same midpoint', () => {
    for (const band of FULL_RESTORE_BAND_VALUES) {
      const kernelBand = FULL_RESTORE_BAND_MAP[band];
      // `unknown` has no midpoint on either side — the kernel substitutes a size-class default.
      if (band === 'unknown' || kernelBand === 'unknown') {
        continue;
      }
      expect(RESTORE_DAYS_BY_BAND[kernelBand], band).toBe(FULL_RESTORE_DAYS[band]);
    }
  });

  it('Q18 revealed worst outage: the kernel reads the same midpoint', () => {
    for (const band of WORST_OUTAGE_BAND_VALUES) {
      expect(KERNEL_WORST_OUTAGE_DAYS[WORST_OUTAGE_BAND_MAP[band]], band).toBe(WORST_OUTAGE_DAYS[band]);
    }
  });
});
