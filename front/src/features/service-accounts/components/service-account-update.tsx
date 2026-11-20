import { Button, Input, Switch } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import type { FunctionComponent, ReactNode } from 'react';
import { Suspense } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Loader, MultiSelectField, NullableTextarea } from '../../../components';
import { DrawerForm, DrawerFormActions, useFormDrawerContext } from '../../../components/shared';
import { FormDrawer } from '../../../components/shared/form-drawer';
import { useTRPC } from '../../../lib';

const manageSchema = z.object({
  name: z.string().min(1),
  active: z.boolean(),
  description: z.string().nullable(),
  groupIds: z.array(z.string()),
});

const ManageServiceAccountForm: FunctionComponent<{
  serviceAccountId: string,
}> = ({ serviceAccountId }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();

  const { data: serviceAccount } = useSuspenseQuery(trpc.serviceAccounts.getServiceAccount.queryOptions({ id: serviceAccountId }));
  const { data: allGroups } = useSuspenseQuery(trpc.groups.getGroups.queryOptions());
  const { data: serviceAccountGroups } = useSuspenseQuery(trpc.serviceAccounts.getServiceAccountGroups.queryOptions({ serviceAccountId }));

  const initialGroupIds = (serviceAccountGroups?.map((g) => g.group.id) ?? []).sort();

  const form = useForm<z.infer<typeof manageSchema>>({
    resolver: zodResolver(manageSchema),
    defaultValues: {
      name: serviceAccount?.name ?? '',
      active: serviceAccount?.active ?? true,
      description: serviceAccount?.description ?? null,
      groupIds: [...initialGroupIds],
    },
  });

  const updateMutation = useMutation(trpc.serviceAccounts.updateServiceAccount.mutationOptions({ meta: { successMessage: msg`Service account updated successfully.` } }));
  const addGroupMutation = useMutation(trpc.serviceAccounts.addGroupToServiceAccount.mutationOptions({ meta: { skipSuccessToast: true } }));
  const removeGroupMutation = useMutation(trpc.serviceAccounts.removeGroupFromServiceAccount.mutationOptions({ meta: { skipSuccessToast: true } }));

  const onSubmit = async (values: z.infer<typeof manageSchema>) => {
    await updateMutation.mutateAsync({ id: serviceAccountId, name: values.name, active: values.active, description: values.description });

    const initialSet = new Set(initialGroupIds);
    const toAdd = values.groupIds.filter((id) => !initialSet.has(id));
    const toRemove = initialGroupIds.filter((id) => !new Set(values.groupIds).has(id));

    await Promise.all([
      ...toAdd.map((groupId) => addGroupMutation.mutateAsync({ serviceAccountId, groupId })),
      ...toRemove.map((groupId) => removeGroupMutation.mutateAsync({ serviceAccountId, groupId })),
    ]);

    closeDrawer();
  };

  const groupOptions = allGroups.map((group) => ({ label: group.name, value: group.id }));

  return (
    <DrawerForm
      form={form}
      onSubmit={onSubmit}
      footer={(
        <DrawerFormActions isPending={form.formState.isSubmitting} disabled={!form.formState.isDirty} />
      )}
    >
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Input
            {...field}
            label={t`Name`}
            required
            placeholder={t`Service account name`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="description"
        render={({ field, fieldState }) => (
          <NullableTextarea
            {...field}
            label={t`Description`}
            placeholder={t`Optional description`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="active"
        render={({ field }) => (
          <Switch checked={field.value} onCheckedChange={field.onChange} label={t`Active`} />
        )}
      />
      <Controller
        control={form.control}
        name="groupIds"
        render={({ field, fieldState }) => (
          <MultiSelectField
            options={groupOptions}
            value={field.value}
            onChange={(next) => field.onChange([...next].sort())}
            onBlur={field.onBlur}
            inputRef={field.ref}
            label={t`Groups`}
            placeholder={t`Select groups`}
            emptyMessage={t`No groups found`}
            error={fieldState.error?.message}
          />
        )}
      />
    </DrawerForm>
  );
};

interface ManageServiceAccountProps {
  serviceAccountId: string,
  trigger?: ReactNode,
}

export const ManageServiceAccount: FunctionComponent<ManageServiceAccountProps> = ({
  serviceAccountId,
  trigger,
}) => {
  const trpc = useTRPC();
  const { data: serviceAccount } = useQuery(trpc.serviceAccounts.getServiceAccount.queryOptions({ id: serviceAccountId }));
  const name = serviceAccount?.name ?? '';

  return (
    <FormDrawer title={t`Manage service account - ${name}`} trigger={trigger ?? <Button>{t`Manage`}</Button>}>
      <Suspense fallback={<Loader />}>
        <ManageServiceAccountForm serviceAccountId={serviceAccountId} />
      </Suspense>
    </FormDrawer>
  );
};
