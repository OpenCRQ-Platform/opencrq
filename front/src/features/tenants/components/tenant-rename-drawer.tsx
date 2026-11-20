/*
Copyright (c) 2026 Filigran SAS

This file is part of the OpenCRQ Enterprise Edition ("EE") and is
licensed under the OpenCRQ Enterprise Edition License (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://github.com/OpenCRQ-Platform/opencrq/blob/main/LICENSE

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

import { Input } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { useMutation } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { DrawerForm, DrawerFormActions, FormDrawer, requiredNameSchema, useFormDrawerContext } from '../../../components/shared';
import { useTRPC } from '../../../lib';

interface RenameValues {
  name: string,
}

interface RenameFormProps {
  tenant: { id: string, name: string },
  onRenamed: () => void,
}

const RenameForm: FunctionComponent<RenameFormProps> = ({ tenant, onRenamed }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const form = useForm<RenameValues>({
    resolver: zodResolver(z.object({ name: requiredNameSchema() })),
    defaultValues: { name: tenant.name },
  });

  const renameTenant = useMutation(trpc.tenants.renameTenant.mutationOptions({
    meta: { successMessage: msg`Tenant renamed successfully.` },
    onSuccess: () => {
      onRenamed();
      closeDrawer();
    },
  }));

  const submit = ({ name }: RenameValues) => {
    if (name === tenant.name) {
      closeDrawer();
      return;
    }
    renameTenant.mutate({ id: tenant.id, name });
  };

  return (
    <DrawerForm
      form={form}
      onSubmit={submit}
      footer={<DrawerFormActions isPending={renameTenant.isPending} submitLabel={t`Save`} />}
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

export const TenantRenameDrawer: FunctionComponent<{
  open: boolean,
  onOpenChange: (open: boolean) => void,
  tenant: { id: string, name: string },
  onRenamed: () => void,
}> = ({ open, onOpenChange, tenant, onRenamed }) => (
  <FormDrawer open={open} onClose={() => onOpenChange(false)} title={t`Rename the tenant`}>
    {open && <RenameForm tenant={tenant} onRenamed={onRenamed} />}
  </FormDrawer>
);
