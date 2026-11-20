import { Input, Textarea } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { DrawerForm, DrawerFormActions, FormDrawer, OwnerSelect, useFormDrawerContext } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { formatDate } from '../../../utils';
import { changedPeriodStart, editYearOptions, periodStartParts, reviewPeriodEnd, reviewUpdatePayload } from '../budget-review-utils';
import { FiscalYearStartFields } from '../ui/fiscal-year-start-fields';
import { ReviewNotice } from '../ui/review-notice';

const editSchema = z.object({
  name: z.string().trim().min(1).max(200),
  ownerId: z.string().nullable(),
  context: z.string().nullable(),
  startYear: z.number().int(),
  startMonth: z.number().int().min(1).max(12),
});

type EditValues = z.infer<typeof editSchema>;

interface EditableBudgetReview {
  id: string,
  name: string,
  ownerId: string | null,
  context: string | null,
  periodStart: string,
}

const PeriodChangeNotice: FunctionComponent<{ periodStart: string }> = ({ periodStart }) => {
  const from = formatDate(periodStart);
  const to = formatDate(reviewPeriodEnd(periodStart));
  return (
    <ReviewNotice>
      <Trans>From {from} to {to}: the figures will have to be re-simulated.</Trans>
    </ReviewNotice>
  );
};

const BudgetReviewEditForm: FunctionComponent<{ review: EditableBudgetReview }> = ({ review }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  // The form's defaults are read once, so a refetch moving the start while the drawer is open must
  // not turn an untouched form into a move back.
  const [storedPeriodStart] = useState(review.periodStart);
  const stored = periodStartParts(storedPeriodStart);
  const years = editYearOptions(storedPeriodStart);
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: review.name,
      ownerId: review.ownerId,
      context: review.context,
      startYear: stored.year,
      startMonth: stored.month,
    },
  });

  const updateReview = useMutation(trpc.budgetReviews.updateBudgetReview.mutationOptions({
    meta: { successMessage: msg`Budget review updated successfully.` },
    onSuccess: () => closeDrawer(),
  }));

  const startYear = useWatch({ control: form.control, name: 'startYear' });
  const startMonth = useWatch({ control: form.control, name: 'startMonth' });
  const movedTo = changedPeriodStart(storedPeriodStart, startYear, startMonth);

  return (
    <DrawerForm
      form={form}
      onSubmit={(values) => updateReview.mutate({ id: review.id, values: reviewUpdatePayload(storedPeriodStart, values) })}
      footer={<DrawerFormActions isPending={updateReview.isPending} />}
    >
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
          form.setValue('startYear', year, { shouldDirty: true });
          form.setValue('startMonth', month, { shouldDirty: true });
        }}
      />
      {movedTo !== null && <PeriodChangeNotice periodStart={movedTo} />}
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

export const BudgetReviewEditDrawer: FunctionComponent<{
  open: boolean,
  onOpenChange: (open: boolean) => void,
  review: EditableBudgetReview,
}> = ({ open, onOpenChange, review }) => {
  const reviewName = review.name;
  return (
    <FormDrawer open={open} onClose={() => onOpenChange(false)} title={t`Edit ${reviewName}`}>
      {open && <BudgetReviewEditForm review={review} />}
    </FormDrawer>
  );
};
