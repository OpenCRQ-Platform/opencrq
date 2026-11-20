import { Text } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { t } from '@lingui/core/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { Controller, useForm, useFormState, useWatch } from 'react-hook-form';
import { z } from 'zod';
import type { RiskToleranceFormValues } from '../../risk-tolerance';
import { InfoTooltip, UnsavedChangesDialog } from '../../../components/shared';
import { Loader } from '../../../components/ui/loader';
import { useTRPC } from '../../../lib';
import { AnnualLossField, completeTolerance, isToleranceBlank, isToleranceIncomplete, MaxExceedancePercentField, riskToleranceFieldsSchema, toFormValues } from '../../risk-tolerance';
import { useOnboardingWizard } from '../hooks/use-onboarding-wizard';
import { OnboardingStepLayout } from './onboarding-step-layout';
import { SeeAllLink } from './see-all-link';

const ToleranceForm: FunctionComponent<{ organizationId: string }> = ({ organizationId }) => {
  const trpc = useTRPC();
  const { data: scope } = useQuery(trpc.organizations.getRiskTolerance.queryOptions({ organizationId }));
  const setRiskTolerance = useMutation(trpc.organizations.setRiskTolerance.mutationOptions({
    meta: { skipSuccessToast: true },
  }));

  const form = useForm<RiskToleranceFormValues>({
    resolver: zodResolver(z.object(riskToleranceFieldsSchema())),
    // A doorbell refetching the tolerance must not undo what the reader is typing.
    resetOptions: { keepDirtyValues: true },
    values: scope?.tolerance ? toFormValues(scope.tolerance) : undefined,
  });

  const { touchedFields } = useFormState({ control: form.control });
  const [leaveAttempted, setLeaveAttempted] = useState(false);
  const incomplete = isToleranceIncomplete(useWatch({ control: form.control }));
  const blocker = useBlocker({
    shouldBlockFn: () => incomplete,
    withResolver: true,
    enableBeforeUnload: incomplete,
  });
  // The reader fills the pair field by field, so an error waits until both fields were left, or until leaving was attempted.
  const showErrors = (touchedFields.annualLoss === true && touchedFields.maxExceedancePercent === true) || leaveAttempted;

  /**
   * Both fields blank write nothing and say nothing. Once one is filled, the pair is checked and
   * nothing is written until both are valid.
   */
  const saveWhenComplete = async () => {
    if (isToleranceBlank(form.getValues())) {
      form.clearErrors();
      return;
    }
    if (!(await form.trigger())) {
      return;
    }
    const tolerance = completeTolerance(form.getValues());
    const stored = scope?.tolerance;
    if (tolerance === null || (stored?.annualLoss === tolerance.annualLoss && stored.maxExceedanceProbability === tolerance.maxExceedanceProbability)) {
      return;
    }
    try {
      await setRiskTolerance.mutateAsync({ organizationId, tolerance });
    } catch {
      // The failed write already raised its own error toast.
    }
  };

  if (scope === undefined) {
    return <Loader />;
  }

  return (
    <OnboardingStepLayout
      stepKey="tolerance"
      title={t`Risk tolerance`}
      titleAdornment={(
        <InfoTooltip label={t`What the risk tolerance is`}>
          {t`The highest probability the organization accepts that a year's loss exceeds an amount. Applied to each scenario of the scope on its own, never to their sum.`}
        </InfoTooltip>
      )}
      why={t`Your tolerance sets the loss you accept. Each scenario will be placed within or outside it.`}
    >
      <form noValidate onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-4">
        <Controller
          control={form.control}
          name="annualLoss"
          render={({ field, fieldState }) => (
            <AnnualLossField
              name={field.name}
              value={field.value}
              onChange={field.onChange}
              onBlur={() => {
                field.onBlur();
                void saveWhenComplete();
              }}
              inputRef={field.ref}
              error={showErrors ? fieldState.error?.message : undefined}
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
              onBlur={() => {
                field.onBlur();
                void saveWhenComplete();
              }}
              inputRef={field.ref}
              error={showErrors ? fieldState.error?.message : undefined}
            />
          )}
        />
        <Text as="p" variant="content-caption" className="text-default-secondary">{t`Both values are needed to save the tolerance.`}</Text>
      </form>
      <UnsavedChangesDialog
        open={blocker.status === 'blocked'}
        title={t`Incomplete tolerance`}
        description={t`The tolerance needs both values. Leave without saving it?`}
        discardLabel={t`Leave without saving`}
        onStay={() => {
          setLeaveAttempted(true);
          void form.trigger();
          blocker.reset?.();
        }}
        onDiscard={() => blocker.proceed?.()}
      />
      <div>
        <SeeAllLink to="/$tenantId/{-$organizationId}/details/overview" organizationId={organizationId} label={t`See the risk scope`} />
      </div>
    </OnboardingStepLayout>
  );
};

export const ToleranceStep: FunctionComponent = () => {
  const { data: wizard } = useOnboardingWizard();

  if (wizard === null || wizard === undefined) {
    return <Loader />;
  }

  return <ToleranceForm organizationId={wizard.organizationId} />;
};
