import { Input } from '@filigran/design-system';
import { useToast } from '@filigran/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { DrawerForm, DrawerFormActions, EditEntityDrawer, MultiSelectField, useFormDrawerContext } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { useTenant } from '../../../providers';

interface EditGroupProps {
  groupId: string,
  onCloseDrawer?: () => void,
}

const formSchema = z.object({
  name: z.string().min(1),
  roleIds: z.array(z.string()),
  memberIds: z.array(z.string()),
  serviceAccountIds: z.array(z.string()),
});

const EditGroupForm: FunctionComponent<{
  groupId: string,
  entityName: string,
}> = ({ groupId, entityName }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const { toast } = useToast();

  const { data: roles } = useSuspenseQuery(trpc.roles.getRoles.queryOptions());
  const { data: groupRoles } = useSuspenseQuery(trpc.groups.getGroupRoles.queryOptions({ groupId }));
  const { tenantId } = useTenant();
  const { data: tenantUsers } = useSuspenseQuery(trpc.tenants.getTenantUsers.queryOptions({ tenantId }));
  const { data: groupUsers } = useSuspenseQuery(trpc.groups.getGroupUsers.queryOptions({ groupId }));
  const { data: allServiceAccounts } = useSuspenseQuery(trpc.serviceAccounts.getServiceAccounts.queryOptions());
  const { data: groupServiceAccounts } = useSuspenseQuery(trpc.serviceAccounts.getGroupServiceAccounts.queryOptions({ groupId }));

  const initialRoleIds = (groupRoles?.map((r) => r.role.id) ?? []).sort();
  const initialMemberIds = (groupUsers?.map((gu) => gu.user.id) ?? []).sort();
  const initialServiceAccountIds = (groupServiceAccounts?.map((gsa) => gsa.serviceAccount.id) ?? []).sort();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: entityName,
      roleIds: [...initialRoleIds],
      memberIds: [...initialMemberIds],
      serviceAccountIds: [...initialServiceAccountIds],
    },
  });

  const updateGroupMutation = useMutation(trpc.groups.updateGroup.mutationOptions({ meta: { skipSuccessToast: true } }));
  const addRoleMutation = useMutation(trpc.groups.addRoleToGroup.mutationOptions({ meta: { skipSuccessToast: true } }));
  const removeRoleMutation = useMutation(trpc.groups.removeRoleFromGroup.mutationOptions({ meta: { skipSuccessToast: true } }));
  const addUserMutation = useMutation(trpc.groups.addUserToGroup.mutationOptions({ meta: { skipSuccessToast: true } }));
  const removeUserMutation = useMutation(trpc.groups.removeUserFromGroup.mutationOptions({ meta: { skipSuccessToast: true } }));
  const addServiceAccountMutation = useMutation(trpc.serviceAccounts.addGroupToServiceAccount.mutationOptions({ meta: { skipSuccessToast: true } }));
  const removeServiceAccountMutation = useMutation(trpc.serviceAccounts.removeGroupFromServiceAccount.mutationOptions({ meta: { skipSuccessToast: true } }));

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const nameChanged = values.name.trim() !== entityName;

    const initialRoleSet = new Set(initialRoleIds);
    const currentRoleSet = new Set(values.roleIds);
    const rolesToAdd = currentRoleSet.difference(initialRoleSet);
    const rolesToRemove = initialRoleSet.difference(currentRoleSet);

    const initialMemberSet = new Set(initialMemberIds);
    const currentMemberSet = new Set(values.memberIds);
    const membersToAdd = currentMemberSet.difference(initialMemberSet);
    const membersToRemove = initialMemberSet.difference(currentMemberSet);

    const initialServiceAccountSet = new Set(initialServiceAccountIds);
    const currentServiceAccountSet = new Set(values.serviceAccountIds);
    const serviceAccountsToAdd = currentServiceAccountSet.difference(initialServiceAccountSet);
    const serviceAccountsToRemove = initialServiceAccountSet.difference(currentServiceAccountSet);

    const promises: Array<Promise<unknown>> = [];
    if (nameChanged) {
      promises.push(updateGroupMutation.mutateAsync({ id: groupId, name: values.name.trim() }));
    }
    promises.push(
      ...[...rolesToAdd].map((roleId) => addRoleMutation.mutateAsync({ groupId, roleId })),
      ...[...rolesToRemove].map((roleId) => removeRoleMutation.mutateAsync({ groupId, roleId })),
      ...[...membersToAdd].map((userId) => addUserMutation.mutateAsync({ groupId, userId })),
      ...[...membersToRemove].map((userId) => removeUserMutation.mutateAsync({ groupId, userId })),
      ...[...serviceAccountsToAdd].map((serviceAccountId) => addServiceAccountMutation.mutateAsync({ serviceAccountId, groupId })),
      ...[...serviceAccountsToRemove].map((serviceAccountId) => removeServiceAccountMutation.mutateAsync({ serviceAccountId, groupId })),
    );

    if (promises.length > 0) {
      await Promise.all(promises);
      toast({ description: t`Group updated successfully.` });
    }
    closeDrawer();
  };

  const roleOptions = (roles ?? []).map((role) => ({ label: role.name, value: role.id }));
  const userOptions = (tenantUsers ?? []).map(({ userId, user }) => ({ label: user.name ?? user.email, value: userId }));
  const serviceAccountOptions = (allServiceAccounts ?? []).map((sa) => ({ label: sa.name, value: sa.id }));

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
            placeholder={t`Group name`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="roleIds"
        render={({ field, fieldState }) => (
          <MultiSelectField
            options={roleOptions}
            value={field.value}
            onChange={(next) => field.onChange([...next].sort())}
            onBlur={field.onBlur}
            inputRef={field.ref}
            label={t`Roles`}
            placeholder={t`Select roles`}
            emptyMessage={t`No roles found`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="memberIds"
        render={({ field, fieldState }) => (
          <MultiSelectField
            options={userOptions}
            value={field.value}
            onChange={(next) => field.onChange([...next].sort())}
            onBlur={field.onBlur}
            inputRef={field.ref}
            label={t`Members`}
            placeholder={t`Select users`}
            emptyMessage={t`No users found`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="serviceAccountIds"
        render={({ field, fieldState }) => (
          <MultiSelectField
            options={serviceAccountOptions}
            value={field.value}
            onChange={(next) => field.onChange([...next].sort())}
            onBlur={field.onBlur}
            inputRef={field.ref}
            label={t`Service accounts`}
            placeholder={t`Select service accounts`}
            emptyMessage={t`No service accounts found`}
            error={fieldState.error?.message}
          />
        )}
      />
    </DrawerForm>
  );
};

export const EditGroup: FunctionComponent<EditGroupProps> = ({
  groupId,
  onCloseDrawer,
}) => {
  const trpc = useTRPC();
  const { data: group } = useQuery(trpc.groups.getGroup.queryOptions({ id: groupId }));
  const groupName = group?.name ?? '';

  return (
    <EditEntityDrawer title={t`Update group - ${groupName}`} entityName={groupName} onClose={onCloseDrawer}>
      <EditGroupForm groupId={groupId} entityName={groupName} />
    </EditEntityDrawer>
  );
};
