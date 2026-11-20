import type { FunctionComponent } from 'react';
import { useEffect } from 'react';
import { Form } from '@filigran/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Pencil, Sparkles } from 'lucide-react';
import type { Control } from 'react-hook-form';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useDebouncedCallback } from 'use-debounce';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { IconButtonGroupItem } from '../../../components/ui/icon-button-group';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { useTRPC } from '../../../lib';
import { InfoTooltip, NumberFormInput, SectionCard } from '../../../components';
import { IconButtonGroup } from '../../../components/ui/icon-button-group';
import { ScenarioCatalogLine } from '../../threat-event-frequency';
import { formatEventsPerYear } from './crq-tef-input-utils';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type TefMode = RouterOutputs['crqIndicators']['getTefMode'];

const formSchema = z
  .object({
    min: z.number().min(0),
    likely: z.number().positive(),
    max: z.number().min(0),
  })
  .superRefine((data, ctx) => {
    if (data.likely < data.min) {
      ctx.addIssue({ code: 'custom', message: t`Most Likely must be ≥ Min`, path: ['likely'] });
    }
    if (data.max < data.likely) {
      ctx.addIssue({ code: 'custom', message: t`Max must be ≥ Most Likely`, path: ['max'] });
    }
  });

type FormValues = z.infer<typeof formSchema>;

interface TefNumberFieldProps {
  control: Control<FormValues>,
  name: keyof FormValues,
  label: string,
  placeholder: string,
  onAfterChange: () => void,
}

const isBlank = (value: number | undefined) => value === undefined || Number.isNaN(value);

// fieldState comes from Controller's own subscription, always in sync unlike useFormContext().getFieldState()
const TefNumberField: FunctionComponent<TefNumberFieldProps> = ({ control, name, label, placeholder, onAfterChange }) => (
  <Controller
    control={control}
    name={name}
    render={({ field, fieldState }) => (
      <NumberFormInput
        label={label}
        required
        min="0"
        step="0.1"
        placeholder={placeholder}
        value={field.value}
        onChange={(next) => {
          field.onChange(next);
          onAfterChange();
        }}
        onBlur={field.onBlur}
        name={field.name}
        ref={field.ref}
        error={isBlank(field.value) ? undefined : fieldState.error?.message}
      />
    )}
  />
);

interface ReadOnlyTefFieldProps {
  label: string,
  value: string | undefined,
}

// Mirrors TefNumberField's box (FormItem's `flex flex-col gap-s`, Input's `h-9 px-3 py-2`)
// so the field's footprint is identical whether it holds an input or read-only text.
const ReadOnlyTefField: FunctionComponent<ReadOnlyTefFieldProps> = ({ label, value }) => (
  <div className="flex flex-col gap-s">
    <span className="txt-sub-content font-medium">{label}</span>
    <div className="txt-default flex h-9 w-full items-center rounded bg-input-bg-default px-3 py-2">
      {value ?? EMPTY_VALUE}
    </div>
  </div>
);

interface CrqTefInputProps {
  riskScenarioId: string,
  organizationId: string,
  attackOutcomeId: string,
}

export const CrqTefInput: FunctionComponent<CrqTefInputProps> = ({ riskScenarioId, organizationId, attackOutcomeId }) => {
  const trpc = useTRPC();
  const { data: tefMode } = useQuery(trpc.crqIndicators.getTefMode.queryOptions({ riskScenarioId }));
  const isAuto = tefMode === 'auto';

  const { data: tefInput } = useQuery(trpc.crqIndicators.getTefInput.queryOptions(
    { riskScenarioId },
    { enabled: !isAuto },
  ));
  // Fetched only in auto mode: the endpoint computes-and-persists a `tef_estimates` row when none
  // exists yet, which must not happen for manual-mode scenarios.
  const { data: autoEstimate } = useQuery(trpc.crqIndicators.getAutoTefEstimate.queryOptions(
    { riskScenarioId },
    { enabled: isAuto },
  ));

  // skipSuccessToast: auto-saved silently whenever the form has valid values
  const upsertTefMutation = useMutation(trpc.crqIndicators.upsertTefInput.mutationOptions({
    meta: { skipSuccessToast: true },
  }));

  // skipSuccessToast: the mode switch itself is the feedback, no separate toast needed
  const setTefModeMutation = useMutation(trpc.crqIndicators.setTefMode.mutationOptions({
    meta: { skipSuccessToast: true },
  }));

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { min: NaN, likely: NaN, max: NaN },
    mode: 'all',
  });

  useEffect(() => {
    if (tefInput) {
      form.reset({ min: tefInput.min, likely: tefInput.likely, max: tefInput.max });
      // No upsert here: the data comes from the DB, no need to write it back immediately
      void form.trigger();
    }
  }, [tefInput, form]);

  const triggerAll = useDebouncedCallback(async () => {
    const isValid = await form.trigger();
    if (isValid) {
      upsertTefMutation.mutate({ riskScenarioId, ...form.getValues() });
    }
  }, 1000);

  const handleModeChange = (nextMode: TefMode) => {
    setTefModeMutation.mutate({ riskScenarioId, tefMode: nextMode });
  };

  const modeItems: Array<IconButtonGroupItem<TefMode>> = [
    { value: 'manual', icon: <Pencil className="size-4" />, tooltip: t`Manual` },
    { value: 'auto', icon: <Sparkles className="size-4" />, tooltip: t`Auto` },
  ];

  return (
    <SectionCard
      title={(
        <span className="inline-flex items-center gap-1">
          {t`Threat Event Frequency (TEF)`}
          <InfoTooltip label={t`How the TEF is estimated`}>
            {isAuto
              ? <Trans>Read in the TEF catalog for this risk scope's country, sector and size.</Trans>
              : <Trans>Estimate the annual frequency of threat events as a three-point range. The PERT distribution will be sampled during simulation.</Trans>}
          </InfoTooltip>
        </span>
      )}
      headerAction={(
        <IconButtonGroup items={modeItems} value={tefMode ?? 'auto'} onChange={handleModeChange} />
      )}
    >
      {isAuto ? (
        <div className="grid grid-cols-3 gap-4">
          <ReadOnlyTefField label={t`Min (events/year)`} value={formatEventsPerYear(autoEstimate?.min)} />
          <ReadOnlyTefField label={t`Likely (events/year)`} value={formatEventsPerYear(autoEstimate?.likely)} />
          <ReadOnlyTefField label={t`Max (events/year)`} value={formatEventsPerYear(autoEstimate?.max)} />
        </div>
      ) : (
        <Form {...form}>
          <form>
            <div className="grid grid-cols-3 gap-4">
              <TefNumberField
                control={form.control}
                name="min"
                label={t`Min (events/year)`}
                placeholder={t`e.g. 0.5`}
                onAfterChange={triggerAll}
              />
              <TefNumberField
                control={form.control}
                name="likely"
                label={t`Likely (events/year)`}
                placeholder={t`e.g. 2.0`}
                onAfterChange={triggerAll}
              />
              <TefNumberField
                control={form.control}
                name="max"
                label={t`Max (events/year)`}
                placeholder={t`e.g. 5.0`}
                onAfterChange={triggerAll}
              />
            </div>
          </form>
        </Form>
      )}
      {tefMode !== undefined && (
        <ScenarioCatalogLine
          organizationId={organizationId}
          attackOutcomeId={attackOutcomeId}
          tefMode={tefMode}
          likely={(isAuto ? autoEstimate?.likely : tefInput?.likely) ?? null}
          autoRead={(isAuto ? autoEstimate?.read : undefined) ?? null}
        />
      )}
    </SectionCard>
  );
};
