import { Input, Textarea } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  DrawerForm,
  DrawerFormActions,
  FormDrawer,
  OwnerSelect,
  SingleSelectField,
  useFormDrawerContext,
} from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { fiscalYearLabel, reviewPeriodStart, reviewYearOptions } from '../budget-review-utils';
import { FiscalYearStartFields } from '../ui/fiscal-year-start-fields';

const createSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  ownerId: z.string().nullable(),
  startYear: z.number().int(),
  startMonth: z.number().int().min(1).max(12),
  context: z.string().nullable(),
});

type CreateValues = z.infer<typeof createSchema>;

const defaultReviewName = (startYear: number, startMonth: number): string => {
  const label = fiscalYearLabel(reviewPeriodStart(startYear, startMonth));
  return t`Fiscal year ${label}`;
};

const emptyValues = (organizationId: string | undefined, startYear: number): CreateValues => ({
  organizationId: organizationId ?? '',
  name: defaultReviewName(startYear, 1),
  ownerId: null,
  startYear,
  startMonth: 1,
  context: null,
});

const BudgetReviewCreateForm: FunctionComponent<{
  organizationId?: string,
  onCreated: (id: string) => void,
}> = ({ organizationId, onCreated }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const years = reviewYearOptions();

  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: emptyValues(organizationId, years[0]),
  });

  const { data: organizations } = useQuery(trpc.organizations.getOrganizations.queryOptions(
    undefined,
    { enabled: organizationId === undefined },
  ));

  const createReview = useMutation(trpc.budgetReviews.createBudgetReview.mutationOptions({
    meta: { successMessage: msg`Budget review created successfully.` },
    onSuccess: (id) => {
      closeDrawer();
      onCreated(id);
    },
  }));

  const onSubmit = ({ startYear, startMonth, ...values }: CreateValues) => {
    createReview.mutate({ ...values, periodStart: reviewPeriodStart(startYear, startMonth) });
  };

  // The name follows the period while it is still the current period's default, so a name the reader typed stays.
  const followPeriod = (startYear: number, startMonth: number) => {
    if (form.getValues('name') === defaultReviewName(form.getValues('startYear'), form.getValues('startMonth'))) {
      form.setValue('name', defaultReviewName(startYear, startMonth));
    }
  };

  const startYear = useWatch({ control: form.control, name: 'startYear' });
  const startMonth = useWatch({ control: form.control, name: 'startMonth' });

  return (
    <DrawerForm
      form={form}
      onSubmit={onSubmit}
      footer={<DrawerFormActions isPending={createReview.isPending} submitLabel={t`Create`} />}
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
      <Controller
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Input {...field} label={t`Name`} required error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={form.control}
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
      <FiscalYearStartFields
        year={startYear}
        month={startMonth}
        years={years}
        onChange={(year, month) => {
          followPeriod(year, month);
          form.setValue('startYear', year, { shouldDirty: true });
          form.setValue('startMonth', month, { shouldDirty: true });
        }}
      />
      <Controller
        control={form.control}
        name="context"
        render={({ field, fieldState }) => (
          <Textarea
            {...field}
            value={field.value ?? ''}
            onChange={(event) => field.onChange(event.target.value === '' ? null : event.target.value)}
            rows={4}
            label={t`Context`}
            placeholder={t`The budget granted, the fiscal year's trade-offs, who this review is presented to.`}
            error={fieldState.error?.message}
          />
        )}
      />
    </DrawerForm>
  );
};

/** The scope is fixed once created: every figure is priced for one scope. */
export const BudgetReviewCreateDrawer: FunctionComponent<{
  open: boolean,
  onOpenChange: (open: boolean) => void,
  /** The scope the list is inside, absent on the list that spans every scope. */
  organizationId?: string,
  onCreated: (id: string) => void,
}> = ({ open, onOpenChange, organizationId, onCreated }) => (
  <FormDrawer
    open={open}
    onClose={() => onOpenChange(false)}
    title={t`Create a budget review`}
  >
    {open && <BudgetReviewCreateForm organizationId={organizationId} onCreated={onCreated} />}
  </FormDrawer>
);
