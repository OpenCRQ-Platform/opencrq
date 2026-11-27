import { DEPENDENCY_RESOURCE_TYPE_NAME_MAX_LENGTH } from '@app/module/client';
import { Input } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { useMutation } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { DrawerForm, DrawerFormActions, FormDrawer, useFormDrawerContext } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { isResourceTypeNameTaken } from '../primary-to-primary-links-utils';

interface ResourceType {
  id: string,
  name: string,
}

const nameSchema = z.object({ name: z.string().trim().min(1).max(DEPENDENCY_RESOURCE_TYPE_NAME_MAX_LENGTH) });

type NameValues = z.infer<typeof nameSchema>;

const ResourceTypeNameForm: FunctionComponent<{ edited: ResourceType | null, types: ReadonlyArray<ResourceType> }> = ({ edited, types }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const form = useForm<NameValues>({ resolver: zodResolver(nameSchema), defaultValues: { name: edited?.name ?? '' } });

  const createType = useMutation(trpc.assetDependencies.createDependencyResourceType.mutationOptions({
    meta: { successMessage: msg`Resource type created successfully.` },
    onSuccess: closeDrawer,
  }));
  const renameType = useMutation(trpc.assetDependencies.renameDependencyResourceType.mutationOptions({
    meta: { successMessage: msg`Resource type renamed successfully.` },
    onSuccess: closeDrawer,
  }));

  const submit = ({ name }: NameValues) => {
    if (edited !== null && name === edited.name) {
      closeDrawer();
      return;
    }
    if (isResourceTypeNameTaken(types, name, edited?.id ?? null)) {
      form.setError('name', { message: t`This name is already taken.` });
      return;
    }
    if (edited === null) {
      createType.mutate({ id: uuidv7(), name });
    } else {
      renameType.mutate({ id: edited.id, name });
    }
  };

  return (
    <DrawerForm
      form={form}
      onSubmit={submit}
      footer={<DrawerFormActions isPending={createType.isPending || renameType.isPending} submitLabel={edited === null ? t`Create` : t`Save`} />}
    >
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Input {...field} label={t`Name`} required error={fieldState.error?.message} />
        )}
      />
    </DrawerForm>
  );
};

export const DependencyResourceTypeDrawer: FunctionComponent<{
  open: boolean,
  onClose: () => void,
  edited: ResourceType | null,
  types: ReadonlyArray<ResourceType>,
}> = ({ open, onClose, edited, types }) => (
  <FormDrawer open={open} onClose={onClose} title={edited === null ? t`Create a resource type` : t`Rename the resource type`}>
    {open && <ResourceTypeNameForm edited={edited} types={types} />}
  </FormDrawer>
);
