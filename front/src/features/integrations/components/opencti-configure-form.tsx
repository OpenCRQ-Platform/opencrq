import {
  Combobox,
  ComboboxClear,
  ComboboxControls,
  ComboboxField,
  ComboboxHelperText,
  ComboboxInput,
  ComboboxLabel,
  ComboboxTrigger,
  Switch,
} from '@filigran/design-system';
import { OPENCTI_THREAT_VISIBILITIES } from '@app/module/client';
import { useToast } from '@filigran/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import type { OpenctiStream } from '../opencti-stream-filter-utils';
import { ComboboxPanel } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { filterOptionsByLabel } from '../../../utils';
import { configureSaveSteps } from '../opencti-configure-utils';
import { defaultServiceAccountChoice, refineServiceAccountChoice, serviceAccountChoiceFields, toServiceAccountChoice } from '../service-account-choice-utils';
import { getConnectors } from './connectors-list';
import { OpenctiStreamFilter } from './opencti-stream-filter';
import { OpenctiStreamOption } from './opencti-stream-option';
import { OpenctiStreamHistoryNotice, OpenctiStreamVerdictNotice } from './opencti-stream-verdict';
import { ThreatVisibilityFields, useOpenctiThreatVisibility } from './opencti-threat-visibility';
import { ServiceAccountChoiceFields } from './service-account-choice-fields';

const configureSchema = z.object({
  streamId: z.string().min(1),
  ...serviceAccountChoiceFields(),
  threatVisibility: z.enum(OPENCTI_THREAT_VISIBILITIES),
}).superRefine((values, ctx) => refineServiceAccountChoice(values, ctx, { accountRequired: true }));

type ConfigureFormValues = z.infer<typeof configureSchema>;

const SelectedStreamDetail: FunctionComponent<{ stream: OpenctiStream }> = ({ stream }) => (
  <div className="flex flex-col gap-4">
    <OpenctiStreamVerdictNotice verdict={stream.verdict} missingRelationships={stream.missingRelationships} />
    {!stream.replaysHistory && <OpenctiStreamHistoryNotice />}
    <div className="flex flex-col gap-1">
      <span className="txt-container-title text-muted-foreground">{t`Stream filter`}</span>
      <OpenctiStreamFilter filterGroup={stream.filterGroup} rawFilter={stream.rawFilter} />
    </div>
  </div>
);

interface UseOpenctiConfigureOptions {
  onSaved?: () => void,
}

/** Suspends on the saved settings, the service accounts and the platform status: render it under a `Suspense`. */
export const useOpenctiConfigure = ({ onSaved }: UseOpenctiConfigureOptions) => {
  const trpc = useTRPC();
  const { toast } = useToast();
  const { data: settings } = useSuspenseQuery(trpc.opencti.getSettings.queryOptions());
  const { data: serviceAccounts } = useSuspenseQuery(trpc.serviceAccounts.getServiceAccounts.queryOptions());
  const { data: connectorsStatus } = useSuspenseQuery(trpc.integrations.getConnectorsStatus.queryOptions());
  const { data: streams, isLoading: isStreamsLoading, isError: isStreamsError } = useQuery(trpc.opencti.listStreams.queryOptions(undefined, { retry: false }));

  const { perMemberUnavailable } = useOpenctiThreatVisibility();
  const savedVisibility = settings?.threatVisibility ?? 'per_member';

  const form = useForm<ConfigureFormValues>({
    resolver: zodResolver(configureSchema),
    defaultValues: {
      streamId: settings?.streamId ?? '',
      ...defaultServiceAccountChoice(getConnectors().opencti.name, serviceAccounts, settings?.serviceAccountId),
      threatVisibility: savedVisibility,
    },
  });

  const configureMutation = useMutation(trpc.opencti.configure.mutationOptions({
    meta: { successMessage: msg`Integration configured successfully.` },
  }));
  // Its toast is the binding's when both are saved, its own otherwise.
  const visibilityMutation = useMutation(trpc.opencti.setThreatVisibility.mutationOptions({
    meta: { skipSuccessToast: true },
  }));

  const save = async (values: ConfigureFormValues): Promise<void> => {
    const choice = toServiceAccountChoice(values);
    const { rebind, setVisibility } = configureSaveSteps(settings, {
      streamId: values.streamId,
      serviceAccountId: 'newServiceAccount' in choice ? null : choice.serviceAccountId,
      threatVisibility: values.threatVisibility,
    });
    if (setVisibility) {
      await visibilityMutation.mutateAsync({ threatVisibility: values.threatVisibility });
    }
    if (rebind) {
      // The stream needs an account: the schema refuses an empty existing one before it gets here.
      if ('newServiceAccount' in choice) {
        await configureMutation.mutateAsync({ streamId: values.streamId, newServiceAccount: choice.newServiceAccount });
      } else if (choice.serviceAccountId !== null) {
        await configureMutation.mutateAsync({ streamId: values.streamId, serviceAccountId: choice.serviceAccountId });
      }
    } else {
      toast({ description: t`Integration configured successfully.` });
    }
    onSaved?.();
  };

  // The Switch's own state flip is the feedback, per the toaster convention for inline state changes.
  const setEnabledMutation = useMutation(trpc.opencti.setEnabled.mutationOptions({
    meta: { skipSuccessToast: true },
  }));

  return {
    form,
    // A failed call has already raised its error toast; the drawer stays open.
    submit: (values: ConfigureFormValues) => save(values).catch(() => undefined),
    isPending: configureMutation.isPending || visibilityMutation.isPending,
    perMemberUnavailable,
    settings,
    serviceAccounts,
    streams: streams ?? [],
    isStreamsLoading,
    isStreamsError,
    platformConfigured: connectorsStatus.opencti?.platformConfigured === true,
    isConfigured: !!(settings?.streamId && settings.serviceAccountId),
    setEnabled: (enabled: boolean) => setEnabledMutation.mutate({ enabled }),
    isSettingEnabled: setEnabledMutation.isPending,
  };
};

export type OpenctiConfigureState = ReturnType<typeof useOpenctiConfigure>;

/** Nothing once the connector is not bound to a stream and a service account: there is nothing to switch. */
export const OpenctiEnabledSwitch: FunctionComponent<{ configure: OpenctiConfigureState }> = ({ configure }) => {
  const { isConfigured, settings, isSettingEnabled, setEnabled } = configure;
  if (!isConfigured) {
    return null;
  }
  return (
    <Switch
      checked={!!settings?.enabled}
      disabled={isSettingEnabled}
      onCheckedChange={setEnabled}
      label={settings?.enabled ? <Trans>Enabled</Trans> : <Trans>Disabled</Trans>}
    />
  );
};

export const OpenctiConfigureFields: FunctionComponent<{ configure: OpenctiConfigureState }> = ({ configure }) => {
  const { form, streams, isStreamsLoading, serviceAccounts, settings } = configure;
  return (
    <>
      <Controller
        control={form.control}
        name="streamId"
        render={({ field, fieldState }) => {
          const selected = streams.find((stream) => stream.id === field.value) ?? null;
          return (
            <div className="flex flex-col gap-4">
              <Combobox
                options={streams}
                value={selected}
                onValueChange={(next) => field.onChange(Array.isArray(next) ? '' : (next?.id ?? ''))}
                getOptionLabel={(option) => option.name}
                filterOptions={filterOptionsByLabel((option) => option.name)}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                renderOption={(option) => <OpenctiStreamOption stream={option} />}
                isOptionTwoLine={() => true}
                disabled={isStreamsLoading}
                openOnFocus
                required
                error={fieldState.invalid}
              >
                <ComboboxLabel required>{t`Live Stream`}</ComboboxLabel>
                <ComboboxField>
                  <ComboboxInput ref={field.ref} onBlur={field.onBlur} placeholder={t`Select a Live Stream`} />
                  <ComboboxControls>
                    <ComboboxClear aria-label={t`Clear the selection`} />
                    <ComboboxTrigger aria-label={t`Toggle the options`} />
                  </ComboboxControls>
                </ComboboxField>
                <ComboboxPanel emptyMessage={t`No Live Stream found`} listAriaLabel={t`Live Streams`} />
                {fieldState.error?.message && <ComboboxHelperText>{fieldState.error.message}</ComboboxHelperText>}
              </Combobox>
              {selected !== null && <SelectedStreamDetail stream={selected} />}
            </div>
          );
        }}
      />
      <ServiceAccountChoiceFields
        control={form.control}
        serviceAccounts={serviceAccounts}
        configuredServiceAccountId={settings?.serviceAccountId ?? undefined}
      />
      <ThreatVisibilityFields control={form.control} perMemberUnavailable={configure.perMemberUnavailable} />
    </>
  );
};
