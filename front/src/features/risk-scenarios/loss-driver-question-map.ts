import {
  isQuestionAnswered,
  LossDriver_CompetitiveAdvantageErosion,
  LossDriver_ContractualPenalties,
  LossDriver_CrisisCommunications,
  LossDriver_CustomerAttritionWinBack,
  LossDriver_ExtortionPayment,
  LossDriver_ForensicsIncidentManagement,
  LossDriver_HardwareReplacement,
  LossDriver_IdentityCreditProtection,
  LossDriver_IncidentLegalCounsel,
  LossDriver_IncrementalOperatingCost,
  LossDriver_InternalResponseSurgeLabor,
  LossDriver_LitigationDefense,
  LossDriver_LostMarginFromDowntime,
  LossDriver_NotificationCallHandling,
  LossDriver_PaymentCardAssessments,
  LossDriver_RegulatoryFines,
  LossDriver_SettlementsDamages,
  LossDriver_StolenFundsNetOfRecovery,
  LossDriver_SystemDataRestoration,
} from '@app/module/client';
import type { QuestionId, RdIpValueBand } from '@app/module/client';
import type { FinancialProfileAnswers } from '../financial-profiles/financial-profile-schema';
import { DRIVER_NAME_BY_ID } from '../financial-profiles/financial-profile-questions';

/** The catalog name for a driver id, resolved once against the same lookup the questionnaire cards use. */
const driverName = (driverId: string): string => {
  const name = DRIVER_NAME_BY_ID.get(driverId);
  if (!name) {
    throw new Error(`[loss-driver-question-map] unknown loss driver id ${driverId}`);
  }
  return name;
};

/**
 * The financial-profile card(s) that unlock each of the eighteen derivable loss drivers, keyed on
 * the driver's catalog id and resolved to its plain-language name below — never the name typed out
 * a second time, so a renamed catalog row cannot silently empty an entry.
 *
 * The entries name the card that actually unlocks each driver, which the composite cards could
 * not: the payment-card band unlocks the ecosystem assessments and the recurring-revenue share
 * unlocks customer attrition, and each is now its own card rather than one field of a card that
 * reported itself answered without them. Every driver whose formula reads `annualRevenueUsd`
 * lists Q1, since a blank revenue leaves it underived exactly as a blank mapped card would.
 *
 * `Hardware & equipment replacement` is deliberately absent: it is never derived from the
 * questionnaire, so it must never be reported as "missing a card" — see
 * {@link NEVER_DERIVED_DRIVER_NAME}.
 */
/* eslint-disable lingui/no-unlocalized-strings -- card ids checked against QuestionId, not copy.
   The split card ids carry a lowercase suffix, which the rule's ALL_CAPS exemption doesn't cover. */
const QUESTIONS_BY_DRIVER_ID: Record<string, ReadonlyArray<QuestionId>> = {
  [LossDriver_ForensicsIncidentManagement]: ['Q1', 'Q7'],
  [LossDriver_IncidentLegalCounsel]: ['Q9a', 'Q10'],
  [LossDriver_CrisisCommunications]: ['Q11a', 'Q9a'],
  [LossDriver_InternalResponseSurgeLabor]: ['Q1', 'Q7'],
  [LossDriver_SystemDataRestoration]: ['Q1', 'Q7'],
  [LossDriver_LostMarginFromDowntime]: ['Q1', 'Q2', 'Q3', 'Q5', 'Q6', 'Q7', 'Q8'],
  [LossDriver_IncrementalOperatingCost]: ['Q1', 'Q2', 'Q3', 'Q5', 'Q6', 'Q7', 'Q8'],
  [LossDriver_ExtortionPayment]: ['Q1', 'Q15'],
  [LossDriver_StolenFundsNetOfRecovery]: ['Q13'],
  [LossDriver_NotificationCallHandling]: ['Q9a'],
  [LossDriver_IdentityCreditProtection]: ['Q9a'],
  [LossDriver_LitigationDefense]: ['Q9a', 'Q11a'],
  [LossDriver_SettlementsDamages]: ['Q9a', 'Q12'],
  [LossDriver_RegulatoryFines]: ['Q1', 'Q9a', 'Q10'],
  [LossDriver_PaymentCardAssessments]: ['Q9b'],
  // Q19's liability cap only ever narrows the max, never blocks derivation, so it stays off this
  // list; Q7 is optional here (a blank restore band falls back to a multiplier of 1), so it would
  // misdirect the analyst to a card that was never the blocker.
  [LossDriver_ContractualPenalties]: ['Q1', 'Q12'],
  [LossDriver_CustomerAttritionWinBack]: ['Q1', 'Q2', 'Q11b'],
  [LossDriver_CompetitiveAdvantageErosion]: ['Q14'],
};
/* eslint-enable lingui/no-unlocalized-strings */

export const LOSS_DRIVER_QUESTION_MAP: Record<string, ReadonlyArray<QuestionId>> = Object.fromEntries(
  Object.entries(QUESTIONS_BY_DRIVER_ID).map(([driverId, questionIds]) => [driverName(driverId), questionIds]),
);

/** The one driver whose underived state is reported with its own wording rather than a card name. */
export const DOMINANT_LOSS_DRIVER_NAME = driverName(LossDriver_CompetitiveAdvantageErosion);

/** Absent from {@link LOSS_DRIVER_QUESTION_MAP} by design: recommended but never derived from the questionnaire. */
export const NEVER_DERIVED_DRIVER_NAME = driverName(LossDriver_HardwareReplacement);

export interface RecommendedDriverSummary {
  lossDriverId: string,
  lossDriverName: string,
}

export interface RecommendedButUnderivedDriver {
  lossDriverId: string,
  lossDriverName: string,
  questionIds: ReadonlyArray<QuestionId>,
}

/**
 * Every driver the loss model recommends for this scenario but that carries no priced estimate,
 * paired with the still-unanswered card(s) that would unlock it. Competitive-advantage erosion is
 * excluded here — its own underived state gets the "dominant loss driver" wording instead, from
 * {@link isDominantLossDriverNeedingInput}. {@link NEVER_DERIVED_DRIVER_NAME} is silently excluded
 * rather than reported. A driver whose mapped questions are all already answered is also excluded:
 * it remains underived for a reason this page cannot attribute to a specific card (e.g. missing
 * organization metadata, or another mapped question that is itself optional), and naming an
 * already-answered card would misdirect the analyst.
 */
export const getRecommendedButUnderivedDrivers = (
  recommendations: ReadonlyArray<RecommendedDriverSummary>,
  presentLossDriverIds: ReadonlySet<string>,
  financialProfileAnswers: FinancialProfileAnswers | null,
): Array<RecommendedButUnderivedDriver> => recommendations
  .filter((recommendation) => !presentLossDriverIds.has(recommendation.lossDriverId))
  .filter((recommendation) => recommendation.lossDriverName !== DOMINANT_LOSS_DRIVER_NAME)
  .flatMap((recommendation) => {
    const questionIds = LOSS_DRIVER_QUESTION_MAP[recommendation.lossDriverName];
    if (!questionIds) {
      if (recommendation.lossDriverName !== NEVER_DERIVED_DRIVER_NAME) {
        // eslint-disable-next-line no-console -- surfaces a catalog/lookup-table mismatch that would otherwise silently drop the driver from the underived-driver banner
        console.warn(
          `[loss-driver-question-map] recommended driver ${recommendation.lossDriverId} (${recommendation.lossDriverName}) has no entry in LOSS_DRIVER_QUESTION_MAP`,
        );
      }
      return [];
    }
    const unansweredQuestionIds = financialProfileAnswers
      ? questionIds.filter((questionId) => !isQuestionAnswered(questionId, financialProfileAnswers))
      : questionIds;
    if (unansweredQuestionIds.length === 0) {
      return [];
    }
    return [{ lossDriverId: recommendation.lossDriverId, lossDriverName: recommendation.lossDriverName, questionIds: unansweredQuestionIds }];
  });

/**
 * The business resource this driver is recommended through, read by its stable `code`: the seeded
 * catalogue states that nothing resolves a row by its display name, and a consumer that did would
 * go quietly dead the day the wording changed.
 */
export const PROPRIETARY_INFORMATION_CODE = 'proprietary-information';

export interface RecommendationViaCells extends RecommendedDriverSummary {
  viaCells: ReadonlyArray<{ businessValueCategoryCode: string }>,
}

/**
 * Q14 unlocks the dominant loss driver, keyed on the proprietary-information resource rather than
 * on the attack outcome. True only when Competitive-advantage erosion is itself recommended,
 * is not already priced (manually or otherwise), its own `viaCells` reach C6, and the
 * organization's profile has not answered Q14 yet — a C6 cell justifying a *different* driver, or
 * a scenario where the dominant driver isn't recommended at all, must not fire this message.
 */
export const isDominantLossDriverNeedingInput = (
  recommendations: ReadonlyArray<RecommendationViaCells>,
  presentLossDriverIds: ReadonlySet<string>,
  rdIpValueBand: RdIpValueBand | null,
): boolean => {
  const dominant = recommendations.find((recommendation) => recommendation.lossDriverName === DOMINANT_LOSS_DRIVER_NAME);
  if (!dominant || presentLossDriverIds.has(dominant.lossDriverId)) {
    return false;
  }
  const c6Active = dominant.viaCells.some((cell) => cell.businessValueCategoryCode === PROPRIETARY_INFORMATION_CODE);
  return c6Active && rdIpValueBand == null;
};
