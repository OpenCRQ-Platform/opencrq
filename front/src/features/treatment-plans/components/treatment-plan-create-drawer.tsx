import { Input, Textarea } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import type { Control } from 'react-hook-form';
import type { FunctionComponent } from 'react';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  DateFormInput,
  DrawerForm,
  DrawerFormActions,
  FormDrawer,
  OwnerSelect,
  SingleSelectField,
  useFormDrawerContext,
} from '../../../components/shared';
import { useTRPC } from '../../../lib';

export const treatmentPlanIdentitySchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().trim().min(1),
  ownerId: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  rationale: z.string().nullable(),
});

export type TreatmentPlanIdentityValues = z.infer<typeof treatmentPlanIdentitySchema>;

interface TreatmentPlanCreateDrawerProps {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  /** The scope the list is inside, absent on the list that spans every scope. */
  organizationId?: string,
  onCreated: (id: string) => void,
}

export const emptyTreatmentPlanValues = (organizationId?: string): TreatmentPlanIdentityValues => ({
  organizationId: organizationId ?? '',
  name: '',
  ownerId: null,
  startDate: null,
  endDate: null,
  rationale: null,
});

export const TreatmentPlanIdentityFields: FunctionComponent<{ control: Control<TreatmentPlanIdentityValues> }> = ({ control }) => (
  <>
    <Controller
      control={control}
      name="name"
      render={({ field, fieldState }) => (
        <Input {...field} label={t`Name`} required error={fieldState.error?.message} />
      )}
    />
    <Controller
      control={control}
      name="ownerId"
      render={({ field, fieldState }) => (
        <OwnerSelect
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          inputRef={field.ref}
          label={t`Owner`}
          error={fieldState.error?.message}
        />
      )}
    />
    <div className="flex gap-4">
      <Controller
        control={control}
        name="startDate"
        render={({ field, fieldState }) => (
          <DateFormInput
            label={t`Start date`}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            inputRef={field.ref}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="endDate"
        render={({ field, fieldState }) => (
          <DateFormInput
            label={t`Due date`}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            inputRef={field.ref}
            error={fieldState.error?.message}
          />
        )}
      />
    </div>
    <Controller
      control={control}
      name="rationale"
      render={({ field, fieldState }) => (
        <Textarea
          {...field}
          value={field.value ?? ''}
          onChange={(event) => field.onChange(event.target.value === '' ? null : event.target.value)}
          rows={5}
          label={t`Rationale`}
          placeholder={t`What this plan sets out to obtain, and why now.`}
          error={fieldState.error?.message}
        />
      )}
    />
  </>
);

const TreatmentPlanCreateForm: FunctionComponent<{
  open: boolean,
  organizationId?: string,
  onCreated: (id: string) => void,
}> = ({ open, organizationId, onCreated }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();

  const form = useForm<TreatmentPlanIdentityValues>({
    resolver: zodResolver(treatmentPlanIdentitySchema),
    defaultValues: emptyTreatmentPlanValues(organizationId),
  });
  const { reset } = form;

  useEffect(() => {
    if (open) {
      reset(emptyTreatmentPlanValues(organizationId));
    }
  }, [open, organizationId, reset]);

  const { data: organizations } = useQuery(trpc.organizations.getOrganizations.queryOptions(
    undefined,
    { enabled: organizationId === undefined },
  ));

  const createPlan = useMutation(trpc.treatmentPlans.createTreatmentPlan.mutationOptions({
    meta: { successMessage: msg`Treatment plan created successfully.` },
    onSuccess: (id) => {
      closeDrawer();
      onCreated(id);
    },
  }));

  const onSubmit = (values: TreatmentPlanIdentityValues) => {
    createPlan.mutate({
      organizationId: values.organizationId,
      name: values.name,
      ownerId: values.ownerId,
      startDate: values.startDate,
      endDate: values.endDate,
      rationale: values.rationale,
    });
  };

  return (
    <DrawerForm
      form={form}
      onSubmit={onSubmit}
      footer={<DrawerFormActions isPending={createPlan.isPending} submitLabel={t`Create`} />}
    >
      {organizationId === undefined && (
        <Controller
          control={form.control}
          name="organizationId"
          render={({ field, fieldState }) => (
            <SingleSelectField
              options={(organizations ?? []).map((organization) => ({ label: organization.name, value: organization.id }))}
              value={field.value === '' ? null : field.value}
              onChange={(next) => field.onChange(next ?? '')}
              onBlur={field.onBlur}
              inputRef={field.ref}
              label={t`Risk scope`}
              required
              placeholder={t`Select a risk scope`}
              emptyMessage={t`No risk scope found`}
              error={fieldState.error?.message}
            />
          )}
        />
      )}
      <TreatmentPlanIdentityFields control={form.control} />
    </DrawerForm>
  );
};

/**
 * A plan starts as a draft, so the scope and the name are the only required fields: nothing here
 * can move it out of `draft`, and the rest is what an arbitration fills in as it moves.
 */
export const TreatmentPlanCreateDrawer: FunctionComponent<TreatmentPlanCreateDrawerProps> = ({
  open,
  onOpenChange,
  organizationId,
  onCreated,
}) => (
  <FormDrawer
    open={open}
    onClose={() => onOpenChange(false)}
    title={t`Create a risk treatment plan`}
  >
    <TreatmentPlanCreateForm open={open} organizationId={organizationId} onCreated={onCreated} />
  </FormDrawer>
);
