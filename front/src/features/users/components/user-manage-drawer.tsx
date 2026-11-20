import { useToast } from '@filigran/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import type { FunctionComponent, ReactNode } from 'react';
import { Suspense, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { FormDrawer, Loader, MultiSelectField } from '../../../components';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { useFormDrawerContext } from '../../../components/shared/form-drawer';
import { DrawerForm } from '../../../components/shared/drawer-form';
import { DrawerFormActions } from '../../../components/shared/drawer-form-actions';
import { useTRPC } from '../../../lib';

interface UserManageDrawerProps {
  userId: string,
  tenantId: string,
  trigger: ReactNode,
  onRemovedFromTenant: () => void,
}

const formSchema = z.object({
  groupIds: z.array(z.string()),
});

const UserManageDrawerForm: FunctionComponent<{
  userId: string,
  tenantId: string,
  onRemovedFromTenant: () => void,
}> = ({ userId, tenantId, onRemovedFromTenant }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const { toast } = useToast();
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);

  const { data: groups } = useSuspenseQuery(trpc.groups.getGroups.queryOptions());
  const { data: userGroups } = useSuspenseQuery(trpc.groups.getUserGroups.queryOptions({ userId }));

  const initialGroupIds = (userGroups?.map((g) => g.group.id) ?? []).sort();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { groupIds: [...initialGroupIds] },
  });

  const addUserToGroupMutation = useMutation(trpc.groups.addUserToGroup.mutationOptions({ meta: { skipSuccessToast: true } }));
  const removeUserFromGroupMutation = useMutation(trpc.groups.removeUserFromGroup.mutationOptions({ meta: { skipSuccessToast: true } }));
  const removeTenantUser = useMutation(trpc.tenants.removeTenantUser.mutationOptions({
    meta: { successMessage: msg`User removed from tenant.` },
    onSuccess: () => {
      closeDrawer();
      // The page behind the drawer is the removed user's own, which the tenant can no longer read.
      onRemovedFromTenant();
    },
  }));

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const initialSet = new Set(initialGroupIds);
    const currentSet = new Set(values.groupIds);
    const toAdd = values.groupIds.filter((id) => !initialSet.has(id));
    const toRemove = initialGroupIds.filter((id) => !currentSet.has(id));

    const promises: Array<Promise<unknown>> = [
      ...toAdd.map((groupId) => addUserToGroupMutation.mutateAsync({ groupId, userId })),
      ...toRemove.map((groupId) => removeUserFromGroupMutation.mutateAsync({ groupId, userId })),
    ];

    if (promises.length > 0) {
      await Promise.all(promises);
      toast({ description: t`User groups updated successfully.` });
    }
    closeDrawer();
  };

  const groupOptions = (groups ?? []).map((group) => ({ label: group.name, value: group.id }));

  return (
    <>
      <DrawerForm
        form={form}
        onSubmit={onSubmit}
        footer={(
          <DrawerFormActions
            isPending={form.formState.isSubmitting}
            disabled={!form.formState.isDirty}
            destructiveAction={{
              label: t`Remove from tenant`,
              onClick: () => setShowRemoveDialog(true),
            }}
          />
        )}
      >
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

      <DeleteConfirmDialog
        open={showRemoveDialog}
        onOpenChange={setShowRemoveDialog}
        onConfirm={() => removeTenantUser.mutate({ tenantId, userId })}
        title={t`Remove user from tenant`}
        description={t`This will revoke the user's access to this tenant. They will lose all tenant-specific roles and group memberships. This action cannot be undone.`}
      />
    </>
  );
};

export const UserManageDrawer: FunctionComponent<UserManageDrawerProps> = ({
  userId,
  tenantId,
  trigger,
  onRemovedFromTenant,
}) => {
  const trpc = useTRPC();
  const { data: user } = useQuery(trpc.users.getUser.queryOptions({ id: userId }));

  const email = user?.email ?? '';

  return (
    <FormDrawer
      title={t`Manage user - ${email}`}
      trigger={trigger}
    >
      <Suspense fallback={<Loader />}>
        <UserManageDrawerForm userId={userId} tenantId={tenantId} onRemovedFromTenant={onRemovedFromTenant} />
      </Suspense>
    </FormDrawer>
  );
};
