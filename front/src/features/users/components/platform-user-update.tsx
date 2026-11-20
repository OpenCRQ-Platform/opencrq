import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { PlatformCapability_ManageUsers } from '@app/module/client';
import type { FunctionComponent, ReactNode } from 'react';
import { Suspense } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Loader, MultiSelectField } from '../../../components';
import { FormDrawer, useFormDrawerContext } from '../../../components/shared/form-drawer';
import { DrawerForm } from '../../../components/shared/drawer-form';
import { DrawerFormActions } from '../../../components/shared/drawer-form-actions';
import { useBatchPlatformMutation } from '../../../hooks';
import { useTRPC } from '../../../lib';

interface EditUserProps {
  userId: string,
  trigger: ReactNode,
}

const formSchema = z.object({
  platformGroupIds: z.array(z.string()),
});

const EditUserForm: FunctionComponent<{
  userId: string,
  canManageUsers: boolean,
}> = ({ userId, canManageUsers }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const runBatch = useBatchPlatformMutation(msg`User platform groups updated successfully.`);

  const { data: platformGroups } = useSuspenseQuery(trpc.platformGroups.getPlatformGroups.queryOptions());
  const { data: userGroups } = useSuspenseQuery(trpc.platformGroups.getUserPlatformGroups.queryOptions({ userId }));

  const initialGroupIds = (userGroups?.map((g) => g.group.id) ?? []).sort();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { platformGroupIds: [...initialGroupIds] },
  });

  const addUserToGroupMutation = useMutation(trpc.platformGroups.addUserToPlatformGroup.mutationOptions({ meta: { skipSuccessToast: true } }));
  const removeUserFromGroupMutation = useMutation(trpc.platformGroups.removeUserFromPlatformGroup.mutationOptions({ meta: { skipSuccessToast: true } }));

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const initialSet = new Set(initialGroupIds);
    const currentSet = new Set(values.platformGroupIds);
    const toAdd = values.platformGroupIds.filter((id) => !initialSet.has(id));
    const toRemove = initialGroupIds.filter((id) => !currentSet.has(id));

    const promises: Array<Promise<unknown>> = [
      ...toAdd.map((platformGroupId) => addUserToGroupMutation.mutateAsync({ platformGroupId, userId })),
      ...toRemove.map((platformGroupId) => removeUserFromGroupMutation.mutateAsync({ platformGroupId, userId })),
    ];

    const ok = await runBatch(promises);
    if (ok) {
      closeDrawer();
    }
  };

  const platformGroupOptions = (platformGroups ?? []).map((group) => ({ label: group.name, value: group.id }));

  return (
    <DrawerForm
      form={form}
      onSubmit={onSubmit}
      footer={(
        <DrawerFormActions
          isPending={form.formState.isSubmitting}
          disabled={!form.formState.isDirty || !canManageUsers}
        />
      )}
    >
      <Controller
        control={form.control}
        name="platformGroupIds"
        render={({ field, fieldState }) => (
          <MultiSelectField
            options={platformGroupOptions}
            value={field.value}
            onChange={(next) => field.onChange([...next].sort())}
            onBlur={field.onBlur}
            inputRef={field.ref}
            label={t`Platform Groups`}
            placeholder={t`Select platform groups`}
            emptyMessage={t`No platform groups found`}
            error={fieldState.error?.message}
          />
        )}
      />
    </DrawerForm>
  );
};

export const EditUser: FunctionComponent<EditUserProps> = ({
  userId,
  trigger,
}) => {
  const trpc = useTRPC();

  const { data: canManageUsers } = useQuery(trpc.platformCapabilities.hasPlatformCapability.queryOptions({ capabilityId: PlatformCapability_ManageUsers }));
  const { data: user } = useQuery(trpc.users.getUser.queryOptions({ id: userId }));

  const userEmail = user?.email ?? '';

  return (
    <FormDrawer
      title={t`Update user - ${userEmail}`}
      trigger={trigger}
    >
      <Suspense fallback={<Loader />}>
        <EditUserForm
          userId={userId}
          canManageUsers={canManageUsers ?? false}
        />
      </Suspense>
    </FormDrawer>
  );
};
