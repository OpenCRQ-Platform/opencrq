import { Button } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { THREAT_RELEVANCE_DEFAULTS } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ThreatRelevanceSettingsFormValues } from './threat-relevance-settings-schema';
import { DetailPageLayout } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { ThreatRelevanceConfidenceGateSection } from './threat-relevance-confidence-gate-section';
import { ThreatRelevanceHalfLivesSection } from './threat-relevance-half-lives-section';
import { buildThreatRelevanceSettingsFormSchema } from './threat-relevance-settings-schema';
import { ThreatRelevanceUnknownActivitySection } from './threat-relevance-unknown-activity-section';

export const ThreatRelevanceSettings: FunctionComponent = () => {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.threatRelevanceSettings.getThreatRelevanceSettings.queryOptions());

  const updateSettings = useMutation(trpc.threatRelevanceSettings.updateThreatRelevanceSettings.mutationOptions({
    meta: { successMessage: msg`Threat relevance settings updated successfully.` },
  }));

  const form = useForm<ThreatRelevanceSettingsFormValues>({
    resolver: zodResolver(buildThreatRelevanceSettingsFormSchema()),
    defaultValues: { ...THREAT_RELEVANCE_DEFAULTS },
    values: data,
    resetOptions: { keepDirtyValues: true },
  });

  const onSubmit = (values: ThreatRelevanceSettingsFormValues) => {
    updateSettings.mutate(values);
  };

  if (isLoading) {
    return <p className="text-muted-foreground"><Trans>Loading settings...</Trans></p>;
  }

  return (
    <DetailPageLayout title={t`Threat Relevance`}>
      <p className="txt-sub-content text-muted-foreground">
        <Trans>Configure the parameters of the attacker mixture that weights MITRE ATT&amp;CK techniques for this tenant: which threat actors are relevant enough to admit, how fast the weight of one decays as its activity ages, and how a threat with no dated activity is scored in a scenario's threat ranking.</Trans>
      </p>

      <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex max-w-lg flex-col gap-6">
        <ThreatRelevanceConfidenceGateSection control={form.control} />
        <ThreatRelevanceHalfLivesSection control={form.control} />
        <ThreatRelevanceUnknownActivitySection control={form.control} />
        <div>
          <Button type="submit" disabled={updateSettings.isPending}>
            <Trans>Save changes</Trans>
          </Button>
        </div>
      </form>
    </DetailPageLayout>
  );
};
