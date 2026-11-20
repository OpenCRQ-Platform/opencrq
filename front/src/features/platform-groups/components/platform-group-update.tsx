import { Input } from '@filigran/design-system';
import { Separator } from '@filigran/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { DrawerForm, DrawerFormActions, EditEntityDrawer, MultiSelectField, useFormDrawerContext } from '../../../components/shared';
import { useBatchPlatformMutation } from '../../../hooks';
import { useTRPC } from '../../../lib';

interface EditPlatformGroupProps {
  platformGroupId: string,
  onCloseDrawer?: () => void,
}

const formSchema = z.object({
  name: z.string().min(1),
  roleIds: z.array(z.string()),
  memberIds: z.array(z.string()),
});

const EditPlatformGroupForm: FunctionComponent<{
  platformGroupId: string,
  entityName: string,
}> = ({ platformGroupId, entityName }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const runBatch = useBatchPlatformMutation(msg`Platform group updated successfully.`);

  const { data: roles } = useSuspenseQuery(trpc.platformRoles.getPlatformRoles.queryOptions());
  const { data: groupRoles } = useSuspenseQuery(trpc.platformGroups.getPlatformGroupRoles.queryOptions({ platformGroupId }));
  const { data: users } = useSuspenseQuery(trpc.users.getUsers.queryOptions());
  const { data: groupUsers } = useSuspenseQuery(trpc.platformGroups.getPlatformGroupUsers.queryOptions({ platformGroupId }));

  const initialRoleIds = (groupRoles?.map((r) => r.role.id) ?? []).sort();
  const initialMemberIds = (groupUsers?.map((gu) => gu.user.id) ?? []).sort();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: entityName,
      roleIds: [...initialRoleIds],
      memberIds: [...initialMemberIds],
    },
  });

  const updateGroupMutation = useMutation(trpc.platformGroups.updatePlatformGroup.mutationOptions({ meta: { skipSuccessToast: true } }));
  const addRoleMutation = useMutation(trpc.platformGroups.addRoleToPlatformGroup.mutationOptions({ meta: { skipSuccessToast: true } }));
  const removeRoleMutation = useMutation(trpc.platformGroups.removeRoleFromPlatformGroup.mutationOptions({ meta: { skipSuccessToast: true } }));
  const addUserMutation = useMutation(trpc.platformGroups.addUserToPlatformGroup.mutationOptions({ meta: { skipSuccessToast: true } }));
  const removeUserMutation = useMutation(trpc.platformGroups.removeUserFromPlatformGroup.mutationOptions({ meta: { skipSuccessToast: true } }));

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const nameChanged = values.name.trim() !== entityName;

    const initialRoleSet = new Set(initialRoleIds);
    const currentRoleSet = new Set(values.roleIds);
    const rolesToAdd = values.roleIds.filter((id) => !initialRoleSet.has(id));
    const rolesToRemove = initialRoleIds.filter((id) => !currentRoleSet.has(id));

    const initialMemberSet = new Set(initialMemberIds);
    const currentMemberSet = new Set(values.memberIds);
    const membersToAdd = values.memberIds.filter((id) => !initialMemberSet.has(id));
    const membersToRemove = initialMemberIds.filter((id) => !currentMemberSet.has(id));

    const promises: Array<Promise<unknown>> = [];
    if (nameChanged) {
      promises.push(updateGroupMutation.mutateAsync({ id: platformGroupId, name: values.name.trim() }));
    }
    promises.push(
      ...rolesToAdd.map((platformRoleId) => addRoleMutation.mutateAsync({ platformGroupId, platformRoleId })),
      ...rolesToRemove.map((platformRoleId) => removeRoleMutation.mutateAsync({ platformGroupId, platformRoleId })),
      ...membersToAdd.map((userId) => addUserMutation.mutateAsync({ platformGroupId, userId })),
      ...membersToRemove.map((userId) => removeUserMutation.mutateAsync({ platformGroupId, userId })),
    );

    const ok = await runBatch(promises);
    if (ok) {
      closeDrawer();
    }
  };

  const roleOptions = (roles ?? []).map((role) => ({ label: role.name, value: role.id }));
  const userOptions = (users ?? []).map((user) => ({ label: user.name ?? user.email, value: user.id }));

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
      <Separator />
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
            label={t`Platform Roles`}
            placeholder={t`Select platform roles`}
            emptyMessage={t`No platform roles found`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Separator />
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
    </DrawerForm>
  );
};

export const EditPlatformGroup: FunctionComponent<EditPlatformGroupProps> = ({
  platformGroupId,
  onCloseDrawer,
}) => {
  const trpc = useTRPC();
  const { data: group } = useQuery(trpc.platformGroups.getPlatformGroup.queryOptions({ id: platformGroupId }));
  const groupName = group?.name ?? '';

  return (
    <EditEntityDrawer title={t`Update platform group - ${groupName}`} entityName={groupName} onClose={onCloseDrawer}>
      <EditPlatformGroupForm platformGroupId={platformGroupId} entityName={groupName} />
    </EditEntityDrawer>
  );
};
