import { Input } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useFormDrawerContext } from './form-drawer';
import { DrawerForm } from './drawer-form';
import { DrawerFormActions } from './drawer-form-actions';
import { requiredNameSchema } from './required-name-schema';

interface CreateNameFormProps {
  onSubmit: (values: { name: string }) => void,
  submitButtonText?: string,
}

export const CreateNameForm: FunctionComponent<CreateNameFormProps> = ({
  onSubmit,
  submitButtonText,
}) => {
  const formSchema = z.object({ name: requiredNameSchema() });

  const form = useForm<{ name: string }>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '' },
  });

  const { closeDrawer } = useFormDrawerContext();

  const handleSubmit = (data: { name: string }) => {
    onSubmit(data);
    form.reset();
    closeDrawer();
  };

  return (
    <DrawerForm
      form={form}
      onSubmit={handleSubmit}
      footer={<DrawerFormActions submitLabel={submitButtonText ?? t`Submit`} />}
    >
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Input
            {...field}
            label={t`Name`}
            required
            error={fieldState.error?.message}
          />
        )}
      />
    </DrawerForm>
  );
};
