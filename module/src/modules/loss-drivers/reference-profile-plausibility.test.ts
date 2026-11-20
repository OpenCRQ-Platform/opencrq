import { describe, expect, it } from 'vitest';
import type { ActivationSetInput } from './derive-estimates-types';
import { acmeCorpDeclaredEstate } from '../../platform-seed/data/declared-estate';
import { acmeCorpFinancialProfile } from '../../platform-seed/data/financial-profiles';
import { ATTACK_OUTCOMES } from '../attack-outcomes/data/attack-outcomes-data';
import { LOSS_ACTIVATION_MATRIX } from './data/loss-activation-matrix';
import { deriveEstimates } from './derive-estimates';
import { COSTLIEST_INCIDENT_MIDPOINT, deriveSizeClass, LOSS_TO_REVENUE_ANCHOR_FRACTION_BY_SIZE_CLASS, SANITY_WARNING_MULTIPLE } from './derive-estimates-helpers';
import { financialProfileToKernelInput, organizationToKernelInput } from './derive-estimates-input-mapping-utils';

/** The PERT mean the sanity gate reads, restated here so the test judges the figure the gate judges. */
const pertMean = (estimate: { min: number, likely: number, max: number }): number =>
  (estimate.min + 4 * estimate.likely + estimate.max) / 6;

/**
 * The seeded reference profile must not raise the platform's own implausibility warning on its own
 * derived figures. It is the profile every demo and every manual test starts from, so a warning
 * there says the coefficient set and the gate disagree about the same organization — and the
 * reader has no way to tell which of the two is wrong.
 *
 * Per attack outcome, not over the whole matrix: no scenario activates all of it at once, so a
 * total summed over every cell is a figure the product never shows anyone.
 */
describe('the seeded reference profile does not warn about itself', () => {
  // The seeded row lacks only the columns the seeder fills on insert; Acme's own organization row
  // supplies the two attributes the kernel reads from it.
  const profile = financialProfileToKernelInput({ ...acmeCorpFinancialProfile, updatedAt: new Date() }, acmeCorpDeclaredEstate);
  const organization = organizationToKernelInput({ revenueBand: '1b_10b', employeeCount: 20_000 });
  const anchorUsd = Math.max(
    profile.annualRevenueUsd! * LOSS_TO_REVENUE_ANCHOR_FRACTION_BY_SIZE_CLASS[deriveSizeClass(profile.annualRevenueUsd!)],
    profile.costliestIncidentBand != null ? COSTLIEST_INCIDENT_MIDPOINT[profile.costliestIncidentBand] : 0,
  );

  const outcomes = [...new Set(LOSS_ACTIVATION_MATRIX.map((cell) => cell.attackOutcomeId))];
  const outcomeName = (id: string) => ATTACK_OUTCOMES.find((outcome) => outcome.id === id)?.name ?? id;

  it.each(outcomes.map((id) => [outcomeName(id), id] as const))(
    'stays under the gate on the widest %s scenario',
    (_name, attackOutcomeId) => {
      // The widest scenario the outcome allows: every business resource it can reach at once.
      const activationSet: ActivationSetInput = LOSS_ACTIVATION_MATRIX
        .filter((cell) => cell.attackOutcomeId === attackOutcomeId)
        .map((cell) => ({ attackOutcomeCatalogId: cell.attackOutcomeId, businessValueCategoryCatalogId: cell.businessValueCategoryId }));

      const total = deriveEstimates(profile, organization, activationSet).estimates.reduce((sum, estimate) => sum + pertMean(estimate), 0);

      expect(total / anchorUsd).toBeLessThanOrEqual(SANITY_WARNING_MULTIPLE);
    },
  );
});
