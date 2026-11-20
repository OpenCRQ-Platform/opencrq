import { Chip, Input } from '@filigran/design-system';
import { useToast } from '@filigran/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { DrawerForm, DrawerFormActions, EditEntityDrawer, useFormDrawerContext } from '../../../components/shared';
import { CapabilitiesChecklist } from '../../../components/shared/capabilities-checklist';
import { useTRPC } from '../../../lib';
import { CAPABILITIES_MAP } from '../capabilities';

interface EditRoleProps {
  roleId: string,
  onCloseDrawer?: () => void,
}

const formSchema = z.object({
  name: z.string().min(1),
  selectedIds: z.array(z.string()),
});

const EditRoleForm: FunctionComponent<{
  roleId: string,
  entityName: string,
}> = ({ roleId, entityName }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const { toast } = useToast();

  const { data: capabilities } = useSuspenseQuery(trpc.capabilities.getCapabilities.queryOptions());
  const { data: roleCapabilities } = useSuspenseQuery(trpc.roles.getRoleCapabilities.queryOptions({ roleId }));
  const initialSelectedIds = (roleCapabilities?.map((c) => c.capability.id) ?? []).sort();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: entityName,
      selectedIds: [...initialSelectedIds],
    },
  });

  const watchedSelectedIds = useWatch({ control: form.control, name: 'selectedIds' });

  const updateRoleMutation = useMutation(trpc.roles.updateRole.mutationOptions({
    meta: { skipSuccessToast: true },
  }));

  const addCapabilityMutation = useMutation(trpc.roles.addCapabilityToRole.mutationOptions({
    meta: { skipSuccessToast: true },
  }));
  const removeCapabilityMutation = useMutation(trpc.roles.removeCapabilityFromRole.mutationOptions({
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
      promises.push(updateRoleMutation.mutateAsync({ id: roleId, name: values.name.trim() }));
    }
    promises.push(
      ...toAdd.map((capabilityId) => addCapabilityMutation.mutateAsync({ roleId, capabilityId })),
      ...toRemove.map((capabilityId) => removeCapabilityMutation.mutateAsync({ roleId, capabilityId })),
    );
    if (promises.length > 0) {
      await Promise.all(promises);
      toast({ description: t`Role updated successfully.` });
    }
    closeDrawer();
  };

  const handleToggle = (id: string, checked: boolean) => {
    const current = form.getValues('selectedIds');
    const next = checked ? [...current, id] : current.filter((x) => x !== id);
    form.setValue('selectedIds', next.sort(), { shouldDirty: true });
  };

  const { data: roleGroups } = useQuery(trpc.roles.getRoleGroups.queryOptions({ roleId }));

  const footer = roleGroups && roleGroups.length > 0 ? (
    <div className="flex flex-col gap-2">
      <span className="txt-sub-content font-normal">{t`Used by groups`}</span>
      <div className="flex flex-wrap gap-1">
        {roleGroups.map((rg) => <Chip key={rg.group.id} label={rg.group.name} />)}
      </div>
    </div>
  ) : undefined;

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
      <CapabilitiesChecklist
        title={t`Capabilities`}
        capabilities={capabilities}
        selectedIds={watchedSelectedIds}
        capabilitiesMap={CAPABILITIES_MAP}
        onToggle={handleToggle}
        footer={footer}
      />
    </DrawerForm>
  );
};

export const EditRole: FunctionComponent<EditRoleProps> = ({
  roleId,
  onCloseDrawer,
}) => {
  const trpc = useTRPC();
  const { data: role } = useQuery(trpc.roles.getRole.queryOptions({ id: roleId }));
  const roleName = role?.name ?? '';

  return (
    <EditEntityDrawer title={t`Update role - ${roleName}`} entityName={roleName} onClose={onCloseDrawer}>
      <EditRoleForm roleId={roleId} entityName={roleName} />
    </EditEntityDrawer>
  );
};
