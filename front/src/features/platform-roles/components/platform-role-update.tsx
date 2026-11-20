import { Input } from '@filigran/design-system';
import { Separator } from '@filigran/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { DrawerForm, DrawerFormActions, EditEntityDrawer, useFormDrawerContext } from '../../../components/shared';
import { CapabilitiesChecklist } from '../../../components/shared/capabilities-checklist';
import { useBatchPlatformMutation } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { PLATFORM_CAPABILITIES_MAP } from '../platform-capabilities';

interface EditPlatformRoleProps {
  platformRoleId: string,
  onCloseDrawer?: () => void,
}

const formSchema = z.object({
  name: z.string().min(1),
  selectedIds: z.array(z.string()),
});

const EditPlatformRoleForm: FunctionComponent<{
  platformRoleId: string,
  entityName: string,
}> = ({ platformRoleId, entityName }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const runBatch = useBatchPlatformMutation(msg`Platform role updated successfully.`);

  const { data: capabilities } = useSuspenseQuery(trpc.platformCapabilities.getPlatformCapabilities.queryOptions());
  const { data: roleCapabilities } = useSuspenseQuery(trpc.platformRoles.getPlatformRoleCapabilities.queryOptions({ platformRoleId }));
  const initialSelectedIds = (roleCapabilities?.map((c) => c.capability.id) ?? []).sort();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: entityName,
      selectedIds: [...initialSelectedIds],
    },
  });

  const watchedSelectedIds = useWatch({ control: form.control, name: 'selectedIds' });

  const updateRoleMutation = useMutation(trpc.platformRoles.updatePlatformRole.mutationOptions({
    meta: { skipSuccessToast: true },
  }));

  const addCapabilityMutation = useMutation(trpc.platformRoles.addCapabilityToPlatformRole.mutationOptions({
    meta: { skipSuccessToast: true },
  }));
  const removeCapabilityMutation = useMutation(trpc.platformRoles.removeCapabilityFromPlatformRole.mutationOptions({
    meta: { skipSuccessToast: true },
  }));

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const nameChanged = values.name.trim() !== entityName;
    const initialSet = new Set(initialSelectedIds);
    const currentSet = new Set(values.selectedIds);
    const toAdd = values.selectedIds.filter((id) => !initialSet.has(id));
    const toRemove = initialSelectedIds.filter((id) => !currentSet.has(id));

    const promises: Array<Promise<unknown>> = [];
    if (nameChanged) {
      promises.push(updateRoleMutation.mutateAsync({ id: platformRoleId, name: values.name.trim() }));
    }
    promises.push(
      ...toAdd.map((capabilityId) => addCapabilityMutation.mutateAsync({ platformRoleId, capabilityId })),
      ...toRemove.map((capabilityId) => removeCapabilityMutation.mutateAsync({ platformRoleId, capabilityId })),
    );
    const ok = await runBatch(promises);
    if (ok) {
      closeDrawer();
    }
  };

  const handleToggle = (id: string, checked: boolean) => {
    const current = form.getValues('selectedIds');
    const next = checked ? [...current, id] : current.filter((x) => x !== id);
    form.setValue('selectedIds', next.sort(), { shouldDirty: true });
  };

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
            placeholder={t`Role name`}
            error={fieldState.error?.message}
          />
        )}
      />
      <Separator />
      <CapabilitiesChecklist
        title={t`Platform Capabilities`}
        capabilities={capabilities}
        selectedIds={watchedSelectedIds}
        capabilitiesMap={PLATFORM_CAPABILITIES_MAP}
        onToggle={handleToggle}
      />
    </DrawerForm>
  );
};

export const EditPlatformRole: FunctionComponent<EditPlatformRoleProps> = ({
  platformRoleId,
  onCloseDrawer,
}) => {
  const trpc = useTRPC();
  const { data: role } = useQuery(trpc.platformRoles.getPlatformRole.queryOptions({ id: platformRoleId }));
  const roleName = role?.name ?? '';

  return (
    <EditEntityDrawer title={t`Update platform role - ${roleName}`} entityName={roleName} onClose={onCloseDrawer}>
      <EditPlatformRoleForm platformRoleId={platformRoleId} entityName={roleName} />
    </EditEntityDrawer>
  );
};
