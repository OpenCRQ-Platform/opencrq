import { Button } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { CrqIndicatorSettingsFormValues } from './crq-indicator-settings-schema';
import { DetailPageLayout } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { crqIndicatorSettingsFormSchema } from './crq-indicator-settings-schema';
import { CrqSettingsExposureWeightsSection } from './crq-settings-exposure-weights-section';
import { CrqSettingsMeasuredValiditySection } from './crq-settings-measured-validity-section';
import { CrqSettingsMonteCarloSection } from './crq-settings-monte-carlo-section';
import { CrqSettingsPhishingSimulationsSection } from './crq-settings-phishing-simulations-section';
import { CrqSettingsSusceptibilitySection } from './crq-settings-susceptibility-section';
import { CrqSettingsUnknownCriticalitySection } from './crq-settings-unknown-criticality-section';
import { CrqSettingsUnknownExposureSection } from './crq-settings-unknown-exposure-section';

export const CrqIndicatorSettings: FunctionComponent = () => {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.crqIndicatorSettings.getCrqIndicatorSettings.queryOptions());

  const updateSettings = useMutation(trpc.crqIndicatorSettings.updateCrqIndicatorSettings.mutationOptions({
    meta: { successMessage: msg`CRQ indicator settings updated successfully.` },
  }));

  const form = useForm<CrqIndicatorSettingsFormValues>({
    resolver: zodResolver(crqIndicatorSettingsFormSchema),
    defaultValues: {
      iterations: 1000,
      exposureWeightInternetFacing: 1.0,
      exposureWeightInternal: 0.4,
      susceptibilityGamma: 0.7,
      measuredValidityDays: null,
      unknownCriticalityCountsAs: 'low',
      unknownExposureCountsAs: 'internal',
      phishingFailureRate: null,
      phishingFailureMeasuredOn: null,
    },
    values: data,
    resetOptions: { keepDirtyValues: true },
  });

  const onSubmit = (values: CrqIndicatorSettingsFormValues) => {
    updateSettings.mutate(values);
  };

  const clearPhishingDeclaration = () => {
    form.setValue('phishingFailureRate', null, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    form.setValue('phishingFailureMeasuredOn', null, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  };

  if (isLoading) {
    return <p className="text-muted-foreground"><Trans>Loading settings...</Trans></p>;
  }

  return (
    <DetailPageLayout title={t`CRQ Indicators`}>
      <p className="txt-sub-content text-muted-foreground">
        <Trans>Configure the Monte Carlo simulation parameters used for Cyber Risk Quantification.</Trans>
      </p>

      <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex max-w-lg flex-col gap-6">
        <CrqSettingsMonteCarloSection control={form.control} />
        <CrqSettingsExposureWeightsSection control={form.control} />
        <CrqSettingsUnknownExposureSection control={form.control} />
        <CrqSettingsSusceptibilitySection control={form.control} />
        <CrqSettingsPhishingSimulationsSection control={form.control} onClear={clearPhishingDeclaration} />
        <CrqSettingsMeasuredValiditySection control={form.control} />
        <CrqSettingsUnknownCriticalitySection control={form.control} />
        <div>
          <Button type="submit" disabled={updateSettings.isPending}>
            <Trans>Save changes</Trans>
          </Button>
        </div>
      </form>
    </DetailPageLayout>
  );
};
