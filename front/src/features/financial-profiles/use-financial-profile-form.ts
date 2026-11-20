import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { FinancialProfileAnswers } from './financial-profile-schema';
import { useTRPC } from '../../lib';
import { EMPTY_FINANCIAL_PROFILE_ANSWERS,  financialProfileAnswersSchema } from './financial-profile-schema';

/**
 * Fetches the organization and its financial profile (if any), and hands back a form bound to
 * the one shared schema plus a save function. An absent `organizationId` is a scope being
 * created: nothing is fetched, the form starts on the same defaults a scope with no profile gets,
 * and `save` takes the id the creation minted.
 */
export const useFinancialProfileForm = (organizationId: string | undefined) => {
  const trpc = useTRPC();
  const { data: organization, isError: isOrganizationError } = useQuery(trpc.organizations.getOrganization.queryOptions(
    { id: organizationId ?? '' },
    { enabled: organizationId !== undefined },
  ));
  const { data: profile, isLoading: isProfileLoading, isError: isProfileError } = useQuery(trpc.financialProfiles.getFinancialProfile.queryOptions(
    { organizationId: organizationId ?? '' },
    { enabled: organizationId !== undefined },
  ));

  const isFreshProfile = profile === null || organizationId === undefined;

  const form = useForm<FinancialProfileAnswers>({
    resolver: zodResolver(financialProfileAnswersSchema),
    defaultValues: { ...EMPTY_FINANCIAL_PROFILE_ANSWERS },
    // A doorbell naming this profile's procedure refetches it and re-runs `values` below, which
    // would otherwise reset the form under whoever is filling it in — and a whole questionnaire is
    // unsaved until Save. Dirty fields therefore survive a refetch; untouched ones still take the
    // server's value.
    resetOptions: { keepDirtyValues: true },
    values: profile ? {
      loadedDailyLabourCost: profile.loadedDailyLabourCost,
      annualRevenue: profile.annualRevenue,
      grossMarginPct: profile.grossMarginPct,
      operatingDaysBand: profile.operatingDaysBand,
      seasonalPeakPct: profile.seasonalPeakPct,
      itDependentRevenuePct: profile.itDependentRevenuePct,
      timeToRevenueImpactBand: profile.timeToRevenueImpactBand,
      fullRestoreBand: profile.fullRestoreBand,
      revenueRecaptureBand: profile.revenueRecaptureBand,
      restoreTestRecency: profile.restoreTestRecency,
      recordsHeldGate: profile.recordsHeldGate,
      individualsBand: profile.individualsBand,
      cardTransactionsBand: profile.cardTransactionsBand,
      sensitiveRecordsBand: profile.sensitiveRecordsBand,
      largestRepositoryBand: profile.largestRepositoryBand,
      regulatoryRegime: profile.regulatoryRegime,
      customerCountBand: profile.customerCountBand,
      b2cRevenuePct: profile.b2cRevenuePct,
      recurringRevenuePct: profile.recurringRevenuePct,
      contractedRevenueBand: profile.contractedRevenueBand,
      contractualLiabilityCapBand: profile.contractualLiabilityCapBand,
      paymentFlowDailyValueBand: profile.paymentFlowDailyValueBand,
      outOfBandVerificationGate: profile.outOfBandVerificationGate,
      outOfBandThreshold: profile.outOfBandThreshold,
      rdIpValueBand: profile.rdIpValueBand,
      ransomPaymentPosture: profile.ransomPaymentPosture,
      ransomPaymentCeiling: profile.ransomPaymentCeiling,
      worstOutageBand: profile.worstOutageBand,
      costliestIncidentBand: profile.costliestIncidentBand,
    } : (isFreshProfile ? {
      // Nothing is pre-filled. Revenue and the labour cost both have a kernel fallback (the band
      // midpoint, the country benchmark) that flags the rows it feeds low-confidence. Writing the
      // guess here would produce identical figures while making them indistinguishable from an
      // exact answer.
      ...EMPTY_FINANCIAL_PROFILE_ANSWERS,
    } : undefined),
  });

  const saveFinancialProfile = useMutation(trpc.financialProfiles.saveFinancialProfile.mutationOptions({
    // The caller raises one toast for the scope and its answers.
    meta: { skipSuccessToast: true },
  }));

  /** `targetOrganizationId` is the scope the creation just minted, which this hook cannot know. */
  const save = (values: FinancialProfileAnswers, targetOrganizationId?: string) => {
    const scopeId = targetOrganizationId ?? organizationId;
    if (scopeId === undefined) {
      return Promise.resolve();
    }
    return saveFinancialProfile.mutateAsync({ organizationId: scopeId, answers: values });
  };

  return {
    organization,
    isLoading: organizationId !== undefined && (organization === undefined || isProfileLoading),
    /** The form then holds its empty values, not the stored answers: saving it would overwrite them. */
    isError: isOrganizationError || isProfileError,
    form,
    save,
    isSaving: saveFinancialProfile.isPending,
  };
};
