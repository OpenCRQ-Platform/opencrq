import { Input } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { EllipsisVertical, Pencil } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CardField, DrawerForm, DrawerFormActions, FormDrawer, MultiSelectField, NullableTextarea, OwnerSelect, useFormDrawerContext } from '../../../components/shared';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { useTRPC } from '../../../lib';
import { EMPTY_VALUE } from '../../../utils/empty-value';

const formSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable(),
  ownerId: z.string().nullable(),
  primaryAssetIds: z.array(z.string()).min(1),
});

type FormValues = z.infer<typeof formSchema>;

interface RiskScenario {
  id: string,
  name: string,
  description: string | null,
  ownerId: string | null,
  organizationId: string,
  attackOutcome: { id: string, name: string } | null,
  primaryAssets: Array<{ id: string, name: string }>,
}

export type RiskScenarioEditFocus = 'name' | 'primaryAssetIds';

interface RiskScenarioActionsProps {
  riskScenario: RiskScenario,
  /** The field the open drawer lands on, `null` when closed. */
  edit: RiskScenarioEditFocus | null,
  onEditChange: (edit: RiskScenarioEditFocus | null) => void,
}

export const RiskScenarioActions: FunctionComponent<RiskScenarioActionsProps> = ({ riskScenario, edit, onEditChange }) => (
  <>
    <IconActions className="h-9 w-9" icon={<EllipsisVertical className="h-5 w-5 text-primary" />} priority="secondary">
      <IconActionsItem startIcon={<Pencil className="h-4 w-4" />} onClick={() => onEditChange('name')}>
        <Trans>Edit</Trans>
      </IconActionsItem>
    </IconActions>
    <FormDrawer
      open={edit !== null}
      onClose={() => onEditChange(null)}
      title={<Trans>Edit Risk Scenario</Trans>}
    >
      <RiskScenarioEditForm riskScenario={riskScenario} focus={edit ?? 'name'} />
    </FormDrawer>
  </>
);

const RiskScenarioEditForm: FunctionComponent<{ riskScenario: RiskScenario, focus: RiskScenarioEditFocus }> = ({ riskScenario, focus }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();

  const { data: primaryAssets } = useQuery(trpc.primaryAssets.getPrimaryAssets.queryOptions(
    { organizationId: riskScenario.organizationId },
  ));

  const primaryAssetOptions = (primaryAssets ?? []).map((a) => ({ label: a.name, value: a.id })).sort((a, b) => a.label.localeCompare(b.label));

  const updateMutation = useMutation(trpc.riskScenarios.updateRiskScenario.mutationOptions({
    meta: { successMessage: msg`Risk scenario updated successfully.` },
    onSuccess: () => {
      closeDrawer();
    },
  }));

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: riskScenario.name,
      description: riskScenario.description,
      ownerId: riskScenario.ownerId,
      primaryAssetIds: riskScenario.primaryAssets.map((a) => a.id),
    },
  });

  useEffect(() => {
    if (focus === 'primaryAssetIds') {
      form.setFocus('primaryAssetIds');
    }
  }, [focus, form]);

  const onSubmit = (values: FormValues) => {
    updateMutation.mutate({
      id: riskScenario.id,
      name: values.name,
      description: values.description,
      ownerId: values.ownerId,
      primaryAssetIds: values.primaryAssetIds,
    });
  };

  return (
    <DrawerForm
      form={form}
      onSubmit={onSubmit}
      footer={<DrawerFormActions isPending={updateMutation.isPending} submitLabel={t`Save`} />}
    >
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Input {...field} label={t`Name`} required error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={form.control}
        name="description"
        render={({ field, fieldState }) => (
          <NullableTextarea {...field} label={t`Description`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={form.control}
        name="ownerId"
        render={({ field, fieldState }) => (
          <OwnerSelect
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            inputRef={field.ref}
            label={t`Owner`}
            error={fieldState.error?.message}
          />
        )}
      />
      <CardField title={t`Attack Outcome`}>
        <p className="txt-body2">{riskScenario.attackOutcome?.name ?? EMPTY_VALUE}</p>
        <p className="txt-sub-content text-muted-foreground">
          <Trans>Fixed when the scenario was created: the timing assumptions and the threat intelligence attached to this scenario are derived from it.</Trans>
        </p>
      </CardField>
      <Controller
        control={form.control}
        name="primaryAssetIds"
        render={({ field, fieldState }) => (
          <MultiSelectField
            options={primaryAssetOptions}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            inputRef={field.ref}
            label={t`Primary Assets`}
            required
            placeholder={t`Select primary assets`}
            emptyMessage={t`No primary assets found`}
            error={fieldState.error?.message}
          />
        )}
      />
    </DrawerForm>
  );
};
