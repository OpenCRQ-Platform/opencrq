import { zodResolver } from '@hookform/resolvers/zod';
import { i18n } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { useForm } from 'react-hook-form';
import { uuidv7 } from 'uuidv7';
import type { RequirementFormValues } from './requirement-form-fields';
import { DrawerForm, DrawerFormActions, FormDrawer, useFormDrawerContext } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { businessResourceName } from '../../business-value-categories';
import { emptyRequirementFormValues, RequirementFormFields, requirementFormSchema, requirementFormValuesFrom } from './requirement-form-fields';

const useRequirementOptions = (organizationId: string) => {
  const trpc = useTRPC();
  const { data: primaryAssets } = useQuery(trpc.primaryAssets.getPrimaryAssets.queryOptions({ organizationId }));
  const { data: categories } = useQuery(trpc.businessValueCategories.getBusinessValueCategories.queryOptions());
  const { data: lossDrivers } = useQuery(trpc.lossDrivers.getLossDrivers.queryOptions());
  return {
    primaryAssetOptions: (primaryAssets ?? []).map((asset) => ({ label: asset.name, value: asset.id })),
    businessResourceOptions: (categories ?? []).map((category) => ({ label: businessResourceName(category), value: category.id })),
    lossDriverOptions: (lossDrivers ?? []).map((driver) => ({ label: driver.name, value: driver.id })),
  };
};

const RequirementCreateForm: FunctionComponent<{ organizationId: string }> = ({ organizationId }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const options = useRequirementOptions(organizationId);
  const form = useForm<RequirementFormValues>({
    resolver: zodResolver(requirementFormSchema),
    defaultValues: emptyRequirementFormValues(),
  });

  const createRequirement = useMutation(trpc.requirements.createRequirement.mutationOptions({
    meta: { successMessage: msg`Requirement created successfully.` },
    onSuccess: () => closeDrawer(),
  }));

  return (
    <DrawerForm
      form={form}
      onSubmit={(values) => createRequirement.mutate({ id: uuidv7(), organizationId, ...values })}
      footer={<DrawerFormActions isPending={createRequirement.isPending} submitLabel={t`Create`} pendingLabel={t`Creating...`} />}
    >
      <RequirementFormFields control={form.control} {...options} />
    </DrawerForm>
  );
};

const RequirementUpdateForm: FunctionComponent<{ requirementId: string, organizationId: string }> = ({ requirementId, organizationId }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const options = useRequirementOptions(organizationId);
  const { data: requirement } = useQuery(trpc.requirements.getRequirement.queryOptions({ id: requirementId }));
  const form = useForm<RequirementFormValues>({
    resolver: zodResolver(requirementFormSchema),
    values: requirement ? requirementFormValuesFrom(requirement) : undefined,
  });

  const updateRequirement = useMutation(trpc.requirements.updateRequirement.mutationOptions({
    meta: { successMessage: msg`Requirement updated successfully.` },
    onSuccess: () => closeDrawer(),
  }));

  if (!requirement) {
    return null;
  }

  return (
    <DrawerForm
      form={form}
      onSubmit={(values) => updateRequirement.mutate({ id: requirementId, ...values })}
      footer={<DrawerFormActions isPending={updateRequirement.isPending} />}
    >
      <RequirementFormFields control={form.control} {...options} />
    </DrawerForm>
  );
};

interface RequirementDrawerProps {
  organizationId: string,
  /** Absent to create one. */
  requirement?: { id: string, name: string },
  open: boolean,
  onClose: () => void,
}

export const RequirementDrawer: FunctionComponent<RequirementDrawerProps> = ({ organizationId, requirement, open, onClose }) => (
  <FormDrawer
    open={open}
    onClose={onClose}
    title={requirement === undefined
      ? t`Create a new requirement`
      : i18n._({ id: 'Edit {name}', message: 'Edit {name}', values: { name: requirement.name } })}
  >
    {requirement === undefined
      ? <RequirementCreateForm organizationId={organizationId} />
      : <RequirementUpdateForm requirementId={requirement.id} organizationId={organizationId} />}
  </FormDrawer>
);
