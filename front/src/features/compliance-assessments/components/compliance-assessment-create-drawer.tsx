import { Input } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { DrawerForm, DrawerFormActions, FormDrawer, SingleSelectField, useFormDrawerContext } from '../../../components/shared';
import { useTRPC } from '../../../lib';

const createAssessmentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  frameworkId: z.string().min(1),
});

type CreateAssessmentValues = z.infer<typeof createAssessmentSchema>;

interface CreateDrawerProps {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onCreated: (id: string) => void,
}

const CreateAssessmentForm: FunctionComponent<{ onCreated: (id: string) => void }> = ({ onCreated }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const { data: frameworks } = useQuery(trpc.complianceAssessments.getFrameworks.queryOptions());
  const defaultFrameworkId = frameworks?.[0]?.id ?? '';

  const form = useForm<CreateAssessmentValues>({
    resolver: zodResolver(createAssessmentSchema),
    defaultValues: { name: '', frameworkId: defaultFrameworkId },
  });
  const { getValues, setValue } = form;

  useEffect(() => {
    if (defaultFrameworkId !== '' && getValues('frameworkId') === '') {
      setValue('frameworkId', defaultFrameworkId);
    }
  }, [defaultFrameworkId, getValues, setValue]);

  const createAssessment = useMutation(trpc.complianceAssessments.createAssessment.mutationOptions({
    meta: { successMessage: msg`Assessment created successfully.` },
    onSuccess: (id) => {
      closeDrawer();
      onCreated(id);
    },
  }));

  return (
    <DrawerForm form={form} onSubmit={(values) => createAssessment.mutate(values)}>
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Input {...field} label={t`Name`} required placeholder={t`NIST CSF 2.0 · Q4 2026`} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={form.control}
        name="frameworkId"
        render={({ field, fieldState }) => (
          <SingleSelectField
            options={(frameworks ?? []).map((framework) => ({ label: framework.title, value: framework.id }))}
            value={field.value === '' ? null : field.value}
            onChange={(next) => field.onChange(next ?? '')}
            onBlur={field.onBlur}
            inputRef={field.ref}
            label={t`Framework`}
            required
            placeholder={t`Select a framework`}
            emptyMessage={t`No framework found`}
            error={fieldState.error?.message}
          />
        )}
      />
      <DrawerFormActions isPending={createAssessment.isPending} submitLabel={t`Create`} />
    </DrawerForm>
  );
};

export const ComplianceAssessmentCreateDrawer: FunctionComponent<CreateDrawerProps> = ({ open, onOpenChange, onCreated }) => (
  <FormDrawer open={open} onClose={() => onOpenChange(false)} title={t`New assessment`}>
    {open && <CreateAssessmentForm onCreated={onCreated} />}
  </FormDrawer>
);
