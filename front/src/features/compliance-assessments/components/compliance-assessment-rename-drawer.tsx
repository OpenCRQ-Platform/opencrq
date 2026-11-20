import { Input } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { useRouter } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { DrawerForm, DrawerFormActions, FormDrawer, useFormDrawerContext } from '../../../components/shared';
import { useTRPC } from '../../../lib';

const renameSchema = z.object({ name: z.string().trim().min(1).max(200) });

type RenameValues = z.infer<typeof renameSchema>;

const RenameForm: FunctionComponent<{ assessmentId: string, name: string }> = ({ assessmentId, name }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const form = useForm<RenameValues>({ resolver: zodResolver(renameSchema), defaultValues: { name } });
  const router = useRouter();
  const renameAssessment = useMutation(trpc.complianceAssessments.renameAssessment.mutationOptions({
    meta: { successMessage: msg`Assessment renamed successfully.` },
    // The breadcrumb reads the name from the route loader, which the live query does not refresh.
    onSuccess: async () => {
      await router.invalidate();
      closeDrawer();
    },
  }));

  return (
    <DrawerForm form={form} onSubmit={(values) => renameAssessment.mutate({ id: assessmentId, name: values.name })}>
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Input {...field} label={t`Name`} required error={fieldState.error?.message} />
        )}
      />
      <DrawerFormActions isPending={renameAssessment.isPending} submitLabel={t`Save`} />
    </DrawerForm>
  );
};

export const ComplianceAssessmentRenameDrawer: FunctionComponent<{
  open: boolean,
  onOpenChange: (open: boolean) => void,
  assessmentId: string,
  name: string,
}> = ({ open, onOpenChange, assessmentId, name }) => (
  <FormDrawer open={open} onClose={() => onOpenChange(false)} title={t`Rename the assessment`}>
    {open && <RenameForm assessmentId={assessmentId} name={name} />}
  </FormDrawer>
);
