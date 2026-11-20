import { Text } from '@filigran/design-system';
import type { ScopeRiskTolerance } from '@app/module/client';
import { zodResolver } from '@hookform/resolvers/zod';
import { i18n } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { RiskToleranceFormValues } from './risk-tolerance-utils';
import { DrawerForm, DrawerFormActions, FormDrawer, useFormDrawerContext } from '../../components/shared';
import { useTRPC } from '../../lib';
import { AnnualLossField, MaxExceedancePercentField, riskToleranceFieldsSchema } from './risk-tolerance-fields';
import { fromFormValues, toFormValues } from './risk-tolerance-utils';

const formatAppliesTo = ({ scenarioCount, ownThresholdCount }: ScopeRiskTolerance): string | null => {
  const applied = scenarioCount - ownThresholdCount;
  if (scenarioCount === 0) {
    return null;
  }
  if (ownThresholdCount === 0) {
    return i18n._({
      id: "Applies to {scenarioCount, plural, one {the scope's only scenario} other {all # of the scope's scenarios}}.",
      message: "Applies to {scenarioCount, plural, one {the scope's only scenario} other {all # of the scope's scenarios}}.",
      values: { scenarioCount },
    });
  }
  if (applied === 0) {
    return i18n._({
      id: "Applies to none of the scope's scenarios, {scenarioCount, plural, one {which has its own threshold} other {each having its own threshold}}.",
      message: "Applies to none of the scope's scenarios, {scenarioCount, plural, one {which has its own threshold} other {each having its own threshold}}.",
      values: { scenarioCount },
    });
  }
  return i18n._({
    id: "Applies to {applied} of the scope's {scenarioCount} scenarios, {ownThresholdCount, plural, one {the other one having its own threshold} other {the other # having their own threshold}}.",
    message: "Applies to {applied} of the scope's {scenarioCount} scenarios, {ownThresholdCount, plural, one {the other one having its own threshold} other {the other # having their own threshold}}.",
    values: { applied, scenarioCount, ownThresholdCount },
  });
};

const ScopeRiskToleranceForm: FunctionComponent<{ organizationId: string, scope: ScopeRiskTolerance }> = ({ organizationId, scope }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const form = useForm<RiskToleranceFormValues>({
    resolver: zodResolver(z.object(riskToleranceFieldsSchema())),
    ...(scope.tolerance === null ? {} : { defaultValues: toFormValues(scope.tolerance) }),
  });
  const setRiskTolerance = useMutation(trpc.organizations.setRiskTolerance.mutationOptions({
    meta: { successMessage: msg`Risk tolerance updated successfully.` },
    onSuccess: () => closeDrawer(),
  }));
  const appliesTo = formatAppliesTo(scope);

  return (
    <DrawerForm
      form={form}
      onSubmit={(values) => setRiskTolerance.mutate({ organizationId, tolerance: fromFormValues(values) })}
      footer={<DrawerFormActions isPending={setRiskTolerance.isPending} submitLabel={t`Save`} />}
    >
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
      {appliesTo !== null && <Text as="p" variant="content-compact" className="text-default-secondary">{appliesTo}</Text>}
    </DrawerForm>
  );
};

interface ScopeRiskToleranceDrawerProps {
  organizationId: string,
  open: boolean,
  onClose: () => void,
}

export const ScopeRiskToleranceDrawer: FunctionComponent<ScopeRiskToleranceDrawerProps> = ({ organizationId, open, onClose }) => {
  const trpc = useTRPC();
  const { data: scope } = useQuery(trpc.organizations.getRiskTolerance.queryOptions({ organizationId }, { enabled: open }));
  const { data: organization } = useQuery(trpc.organizations.getOrganization.queryOptions({ id: organizationId }, { enabled: open }));

  return (
    <FormDrawer open={open} onClose={onClose} title={t`Edit the risk tolerance`} category={organization?.name}>
      {open && scope !== undefined && <ScopeRiskToleranceForm organizationId={organizationId} scope={scope} />}
    </FormDrawer>
  );
};
