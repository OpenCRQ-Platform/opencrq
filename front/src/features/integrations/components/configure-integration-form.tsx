import { Input } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { IntegrationSource, ScheduleCadence } from '@app/module/client';
import { cadenceTakesTime, cadenceTakesWeekday, nextOccurrence, SCHEDULE_CADENCES } from '@app/module/client';
import type { FunctionComponent } from 'react';
import type { Control } from 'react-hook-form';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import type { ConnectorSchedule } from '../connector-detail-types';
import { InfoField, SingleSelectField } from '../../../components/shared';
import { Select, SelectContent, SelectHelperText, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { useTRPC } from '../../../lib';
import { browserTimeZone } from '../../../utils/date-utils';
import { getTimeZoneOptions, toSchedule, toScheduleFields } from '../connector-schedule-utils';
import { formatNextRun, getWeekdayOptions, scheduleCadenceLabel } from '../connector-vocabulary';
import { ServiceAccountSelect } from './service-account-select';

export const MANUAL_SCHEDULE = { cadence: 'manual', atMinute: null, weekday: null, timeZone: null } as const;

// Empty is a legitimate service account: it unbinds the connector from the account it was running as.
export const buildConfigureSchema = () => z.object({
  serviceAccountId: z.string(),
  cadence: z.enum(SCHEDULE_CADENCES),
  weekday: z.number(),
  time: z.string(),
  timeZone: z.string(),
}).refine(
  (values) => toSchedule(values) !== null,
  { path: ['time'], message: t`Enter a time as HH:MM.` },
);

export type ConfigureValues = z.infer<ReturnType<typeof buildConfigureSchema>>;

interface ScheduleFieldsProps {
  control: Control<ConfigureValues>,
  offered: ReadonlyArray<ScheduleCadence>,
  openedAtMs: number,
}

export const ScheduleFields: FunctionComponent<ScheduleFieldsProps> = ({ control, offered, openedAtMs }) => {
  const [cadence, weekday, time, timeZone] = useWatch({ control, name: ['cadence', 'weekday', 'time', 'timeZone'] });
  const schedule = toSchedule({ cadence, weekday, time, timeZone });
  const nextRun = schedule === null ? null : nextOccurrence(schedule, openedAtMs);
  return (
    <div className="flex flex-col gap-4 border-t border-elevation-subtle-soft pt-5">
      <span className="txt-category"><Trans>Schedule</Trans></span>
      <Controller
        control={control}
        name="cadence"
        render={({ field, fieldState }) => (
          <div>
            <Select value={field.value} onValueChange={field.onChange} error={fieldState.invalid}>
              <SelectLabel>{t`Frequency`}</SelectLabel>
              <SelectTrigger ref={field.ref} className="w-full" onBlur={field.onBlur}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {offered.map((option) => (
                  <SelectItem key={option} value={option}>{scheduleCadenceLabel(option)}</SelectItem>
                ))}
              </SelectContent>
              {fieldState.error?.message !== undefined && <SelectHelperText>{fieldState.error.message}</SelectHelperText>}
            </Select>
          </div>
        )}
      />
      {cadenceTakesWeekday(cadence) && (
        <Controller
          control={control}
          name="weekday"
          render={({ field }) => (
            <div>
              <Select value={String(field.value)} onValueChange={(value) => field.onChange(Number(value))}>
                <SelectLabel>{t`Day`}</SelectLabel>
                <SelectTrigger ref={field.ref} className="w-full" onBlur={field.onBlur}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getWeekdayOptions().map((option) => (
                    <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        />
      )}
      {cadenceTakesTime(cadence) && (
        <Controller
          control={control}
          name="time"
          render={({ field, fieldState }) => (
            <Input {...field} label={t`Time`} placeholder={t`HH:MM`} inputMode="numeric" required className="w-40" error={fieldState.error?.message} />
          )}
        />
      )}
      {cadenceTakesTime(cadence) && (
        <Controller
          control={control}
          name="timeZone"
          render={({ field }) => (
            <SingleSelectField
              options={getTimeZoneOptions(field.value, openedAtMs)}
              value={field.value}
              onChange={(next) => {
                if (next !== null) {
                  field.onChange(next);
                }
              }}
              onBlur={field.onBlur}
              inputRef={field.ref}
              label={t`Time zone`}
              required
              clearable={false}
              emptyMessage={t`No time zone matches.`}
            />
          )}
        />
      )}
      {schedule !== null && nextRun !== null && <InfoField title={t`Next run`} value={formatNextRun(nextRun, schedule)} />}
    </div>
  );
};

interface UseConfigureIntegrationOptions {
  sourceId: IntegrationSource,
  schedule: ConnectorSchedule | null,
  onSaved?: () => void,
}

/** Suspends on the service accounts and the saved settings: render it under a `Suspense`. */
export const useConfigureIntegration = ({ sourceId, schedule, onSaved }: UseConfigureIntegrationOptions) => {
  const trpc = useTRPC();
  const { data: serviceAccounts } = useSuspenseQuery(trpc.serviceAccounts.getServiceAccounts.queryOptions());
  const { data: currentSettings } = useSuspenseQuery(trpc.integrations.getSettings.queryOptions({ source: sourceId }));

  const [openedAtMs] = useState(() => Date.now());

  const form = useForm<ConfigureValues>({
    resolver: zodResolver(buildConfigureSchema()),
    defaultValues: {
      serviceAccountId: currentSettings?.serviceAccountId ?? '',
      ...toScheduleFields(schedule ?? MANUAL_SCHEDULE, browserTimeZone()),
    },
  });

  // With a schedule the save is two writes, and the toast waits for the second.
  const configureMutation = useMutation(trpc.integrations.configure.mutationOptions({
    meta: schedule === null ? { successMessage: msg`Integration configured successfully.` } : { skipSuccessToast: true },
  }));
  const setScheduleMutation = useMutation(trpc.connectors.setSchedule.mutationOptions({
    meta: { successMessage: msg`Integration configured successfully.` },
    onSuccess: () => onSaved?.(),
  }));

  const submit = (values: ConfigureValues) => {
    const saved = schedule === null ? null : toSchedule(values);
    configureMutation.mutate({
      source: sourceId,
      serviceAccountId: values.serviceAccountId === '' ? null : values.serviceAccountId,
    }, {
      onSuccess: () => {
        if (saved === null) {
          onSaved?.();
          return;
        }
        setScheduleMutation.mutate({ source: sourceId, ...saved });
      },
    });
  };

  return {
    form,
    submit,
    isPending: configureMutation.isPending || setScheduleMutation.isPending,
    serviceAccounts,
    configuredServiceAccountId: currentSettings?.serviceAccountId ?? undefined,
    schedule,
    openedAtMs,
  };
};

export type ConfigureIntegrationState = ReturnType<typeof useConfigureIntegration>;

export const ConfigureIntegrationFields: FunctionComponent<{ configure: ConfigureIntegrationState }> = ({ configure }) => {
  const { form, serviceAccounts, configuredServiceAccountId, schedule, openedAtMs } = configure;
  return (
    <>
      <Controller
        control={form.control}
        name="serviceAccountId"
        render={({ field, fieldState }) => (
          <ServiceAccountSelect
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            triggerRef={field.ref}
            serviceAccounts={serviceAccounts}
            configuredServiceAccountId={configuredServiceAccountId}
            allowClear
            label={t`Service account`}
            error={fieldState.error?.message}
          />
        )}
      />
      {schedule !== null && <ScheduleFields control={form.control} offered={schedule.offeredCadences} openedAtMs={openedAtMs} />}
    </>
  );
};
