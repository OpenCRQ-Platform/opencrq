import { Button, Radio, RadioGroup } from '@filigran/design-system';
import type { RiskTolerance } from '@app/module/client';
import { zodResolver } from '@hookform/resolvers/zod';
import { i18n } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import { PencilIcon, PlusIcon } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import { useId, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { DrawerForm, DrawerFormActions, FormDrawer, useFormDrawerContext } from '../../components/shared';
import { useTRPC } from '../../lib';
import { formatDollar } from '../../utils';
import { AnnualLossField, MaxExceedancePercentField, riskToleranceFieldsSchema } from './risk-tolerance-fields';
import { formatToleranceProbability, fromFormValues, toFormValues } from './risk-tolerance-utils';
import { ScopeRiskToleranceDrawer } from './scope-risk-tolerance-drawer';

type ThresholdMode = 'scope' | 'scenario';

const isThresholdMode = (value: string): value is ThresholdMode => value === 'scope' || value === 'scenario';

export const formatThreshold = (tolerance: RiskTolerance): string => i18n._({
  id: '{probability} beyond {amount}',
  message: '{probability} beyond {amount}',
  values: { probability: formatToleranceProbability(tolerance.maxExceedanceProbability), amount: formatDollar(tolerance.annualLoss) },
});

/** The two fields are checked only when the scenario sets its own threshold: following the scope leaves them as typed. */
const scenarioToleranceSchema = () => {
  const ownThreshold = z.object(riskToleranceFieldsSchema());
  return z.object({
    mode: z.enum(['scope', 'scenario']),
    annualLoss: z.number().optional(),
    maxExceedancePercent: z.number().optional(),
  }).superRefine((values, ctx) => {
    if (values.mode !== 'scenario') {
      return;
    }
    const parsed = ownThreshold.safeParse(values);
    for (const issue of parsed.error?.issues ?? []) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
    }
  });
};

type ScenarioToleranceFormValues = z.infer<ReturnType<typeof scenarioToleranceSchema>>;

/** The `<label>` covers the card but its action, so the detail line selects the threshold and the action does not. */
const ThresholdCard: FunctionComponent<{ value: ThresholdMode, title: string, detail: string, action?: ReactNode }> = ({ value, title, detail, action }) => {
  const radioId = useId();
  const detailId = `${radioId}-detail`;
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-elevation-subtle-soft p-4">
      <label htmlFor={radioId} className="flex cursor-pointer flex-col gap-1">
        <span className="flex items-center gap-2">
          <Radio id={radioId} value={value} aria-label={title} aria-describedby={detailId} />
          <span className="content-base text-input-value">{title}</span>
        </span>
        <span id={detailId} className="pl-6 content-compact text-input-helper">{detail}</span>
      </label>
      {action !== undefined && <div className="pl-6">{action}</div>}
    </div>
  );
};

interface ScenarioRiskToleranceFormProps {
  riskScenarioId: string,
  organizationId: string,
  scopeTolerance: RiskTolerance | null,
  ownTolerance: RiskTolerance | null,
}

const ScenarioRiskToleranceForm: FunctionComponent<ScenarioRiskToleranceFormProps> = ({ riskScenarioId, organizationId, scopeTolerance, ownTolerance }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const [editingScope, setEditingScope] = useState(false);
  const form = useForm<ScenarioToleranceFormValues>({
    resolver: zodResolver(scenarioToleranceSchema()),
    defaultValues: ownTolerance === null ? { mode: 'scope' } : { mode: 'scenario', ...toFormValues(ownTolerance) },
  });
  const mode = useWatch({ control: form.control, name: 'mode' });
  const setRiskTolerance = useMutation(trpc.riskScenarios.setRiskTolerance.mutationOptions({
    meta: { successMessage: msg`Risk tolerance updated successfully.` },
    onSuccess: () => closeDrawer(),
  }));

  // The scope's drawer stays out of the form: React bubbles its submit through the portal to this form's handler.
  return (
    <>
      <DrawerForm
        form={form}
        onSubmit={(values) => {
          const tolerance = values.mode === 'scenario' && values.annualLoss !== undefined && values.maxExceedancePercent !== undefined
            ? fromFormValues({ annualLoss: values.annualLoss, maxExceedancePercent: values.maxExceedancePercent })
            : null;
          setRiskTolerance.mutate({ riskScenarioId, tolerance });
        }}
        footer={<DrawerFormActions isPending={setRiskTolerance.isPending} submitLabel={t`Save`} />}
      >
        <Controller
          control={form.control}
          name="mode"
          render={({ field }) => (
            <RadioGroup
              value={field.value}
              onValueChange={(value) => {
                if (isThresholdMode(value)) {
                  field.onChange(value);
                }
              }}
              aria-label={t`Threshold applied`}
              className="flex flex-col gap-3"
            >
              <ThresholdCard
                value="scope"
                title={t`Risk scope threshold`}
                detail={scopeTolerance === null ? t`The risk scope sets no tolerance.` : formatThreshold(scopeTolerance)}
                action={(
                  <Button
                    type="button"
                    priority="tertiary"
                    size="sm"
                    startIcon={scopeTolerance === null ? <PlusIcon className="size-3" /> : <PencilIcon className="size-3" />}
                    onClick={() => setEditingScope(true)}
                  >
                    {scopeTolerance === null ? t`Set the risk scope threshold` : t`Edit the risk scope threshold`}
                  </Button>
                )}
              />
              <ThresholdCard
                value="scenario"
                title={t`Scenario's own threshold`}
                detail={t`An annual loss and the highest probability of exceeding it, for this scenario alone.`}
              />
            </RadioGroup>
          )}
        />
        {mode === 'scenario' && (
          <div className="flex flex-col gap-4 pl-6">
            <Controller
              control={form.control}
              name="annualLoss"
              render={({ field, fieldState }) => (
                <AnnualLossField
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  inputRef={field.ref}
                  error={fieldState.error?.message}
                />
              )}
            />
            <Controller
              control={form.control}
              name="maxExceedancePercent"
              render={({ field, fieldState }) => (
                <MaxExceedancePercentField
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  inputRef={field.ref}
                  error={fieldState.error?.message}
                />
              )}
            />
          </div>
        )}
      </DrawerForm>
      <ScopeRiskToleranceDrawer organizationId={organizationId} open={editingScope} onClose={() => setEditingScope(false)} />
    </>
  );
};

interface ScenarioRiskToleranceDrawerProps extends ScenarioRiskToleranceFormProps {
  open: boolean,
  onClose: () => void,
  scenarioName: string,
}

export const ScenarioRiskToleranceDrawer: FunctionComponent<ScenarioRiskToleranceDrawerProps> = ({ open, onClose, scenarioName, ...formProps }) => (
  <FormDrawer open={open} onClose={onClose} title={t`Risk tolerance`} category={scenarioName}>
    {open && <ScenarioRiskToleranceForm {...formProps} />}
  </FormDrawer>
);
