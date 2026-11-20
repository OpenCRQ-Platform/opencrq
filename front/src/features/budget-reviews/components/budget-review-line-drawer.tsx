import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { BUDGET_LINE_MAX_AMORTIZATION_YEARS } from '@app/module/client';
import { IconButton, Input } from '@filigran/design-system';
import { useToast } from '@filigran/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import { X } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { Controller, useForm, useFormState, useWatch } from 'react-hook-form';
import { z } from 'zod';
import type { BudgetLineNature, ControlPosture } from '../budget-review-utils';
import {
  ControlIdPill,
  DrawerFormActions,
  DrawerFormBody,
  DrawerFormColumn,
  FormattedNumberInput,
  FormDrawer,
  isDeliberateSubmit,
  NumberFormInput,
  SelectableCard,
  SingleSelectField,
  useFormDrawerContext,
  useFormDrawerDirtyState,
} from '../../../components/shared';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { useTRPC } from '../../../lib';
import { cn, formatDate } from '../../../utils';
import { buildLineChoices, DEFAULT_AMORTIZATION_YEARS, linePayloadControls, reviewPeriod, sameControls } from '../budget-review-utils';
import { PostureChips, PostureMove } from '../ui/posture-chips';
import { lineNatureLabel } from '../ui/review-chips';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type Review = NonNullable<RouterOutputs['budgetReviews']['getBudgetReview']>;
type ReviewLine = Review['lines'][number];
type ControlPostures = NonNullable<RouterOutputs['budgetReviews']['getBudgetReviewControlPostures']>;
type ReviewControl = ControlPostures['controls'][number];

const NATURES: Array<BudgetLineNature> = ['build', 'run'];

const maxYears = BUDGET_LINE_MAX_AMORTIZATION_YEARS;

const lineSchema = z.object({
  name: z.string().trim().min(1).max(200),
  nature: z.enum(['build', 'run']),
  amountSpent: z.number().min(0).nullable(),
  amortizationYears: z.number().int().min(1).max(BUDGET_LINE_MAX_AMORTIZATION_YEARS).nullable(),
}).refine((values) => values.amountSpent !== null, { path: ['amountSpent'] });

type LineValues = z.infer<typeof lineSchema>;

interface BuildControlsProps {
  controls: Array<ReviewControl>,
  lineId: string | null,
  periodStart: string,
  periodEnd: string,
  selected: Array<string>,
  onToggle: (capabilityId: string) => void,
}

const BuildControls: FunctionComponent<BuildControlsProps> = ({ controls, lineId, periodStart, periodEnd, selected, onToggle }) => {
  const choices = buildLineChoices(controls, lineId, selected);
  const period = reviewPeriod(periodStart, periodEnd);
  const from = formatDate(period.from);
  const to = formatDate(period.to);
  const count = selected.length;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="txt-container-title text-default-secondary">
          {plural(count, { one: 'Controls that moved · # selected', other: 'Controls that moved · # selected' })}
        </span>
        <span className="txt-sub-content text-default-secondary"><Trans>{from} to {to}</Trans></span>
      </div>
      {choices.length === 0 && (
        <p className="txt-sub-content text-default-secondary"><Trans>No control of this scope moved during the period.</Trans></p>
      )}
      {choices.map(({ control, heldBy }) => {
        const heldName = heldBy?.name ?? '';
        return (
          <SelectableCard
            key={control.capabilityId}
            selected={selected.includes(control.capabilityId)}
            disabled={heldBy !== null}
            onToggle={() => onToggle(control.capabilityId)}
            className="py-3"
          >
            <span className="flex flex-col gap-2">
              <span className="flex items-center gap-2">
                <ControlIdPill externalId={control.externalId} size="compact" />
                <span className="min-w-0 truncate">{control.name}</span>
              </span>
              {heldBy === null
                ? <PostureMove start={control.start} end={control.end} />
                : <span className="txt-sub-content"><Trans>In “{heldName}”</Trans></span>}
            </span>
          </SelectableCard>
        );
      })}
    </div>
  );
};

interface FundedControl {
  capabilityId: string,
  externalId: string | null,
  name: string,
  posture: ControlPosture | null,
}

interface RunControlsProps {
  reviewId: string,
  organizationId: string,
  controls: Array<ReviewControl>,
  selected: Array<string>,
  onAdd: (capabilityId: string) => void,
  onRemove: (capabilityId: string) => void,
}

/**
 * The posture shown is the period's start, the level a run line is priced at. The review lists only
 * the controls that moved or that a line funds, so the selection is asked for by name.
 */
const RunControls: FunctionComponent<RunControlsProps> = ({ reviewId, organizationId, controls, selected, onAdd, onRemove }) => {
  const trpc = useTRPC();
  const { data: candidates } = useQuery(trpc.treatmentPlans.getScopeTreatmentPlanCandidates.queryOptions({ organizationId }));
  const { data: postures } = useQuery(trpc.budgetReviews.getBudgetReviewControlPostures.queryOptions(
    { reviewId, including: selected },
    { placeholderData: keepPreviousData },
  ));
  const byReview = new Map((postures?.controls ?? controls).map((control) => [control.capabilityId, control]));
  const byScope = new Map((candidates ?? []).map((candidate) => [candidate.capabilityId, candidate]));
  const funded: Array<FundedControl> = selected.map((capabilityId) => {
    const reviewed = byReview.get(capabilityId);
    const scoped = byScope.get(capabilityId);
    return {
      capabilityId,
      externalId: reviewed?.externalId ?? scoped?.externalId ?? null,
      name: reviewed?.name ?? scoped?.name ?? capabilityId,
      posture: reviewed?.start ?? null,
    };
  });
  const options = (candidates ?? [])
    .filter((candidate) => !selected.includes(candidate.capabilityId))
    .map((candidate) => ({ label: candidate.name, value: candidate.capabilityId }));
  const count = funded.length;

  return (
    <div className="flex flex-col gap-2.5">
      <span className="txt-container-title text-default-secondary">{t`Funded controls · ${count}`}</span>
      <SingleSelectField
        // Remounted on every addition, so the field empties instead of keeping the name just picked.
        key={count}
        options={options}
        value={null}
        onChange={(next) => {
          if (next !== null) {
            onAdd(next);
          }
        }}
        label={t`Add a control`}
        placeholder={t`Search for a control`}
        emptyMessage={t`No control found`}
      />
      <ul className="flex flex-col">
        {funded.map((control) => {
          const controlName = control.name;
          return (
            <li key={control.capabilityId} className="flex items-center gap-3 border-b border-elevation-subtle py-2.5">
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex items-center gap-2">
                  {control.externalId !== null && <ControlIdPill externalId={control.externalId} size="compact" />}
                  <span className="min-w-0 truncate txt-body2">{control.name}</span>
                </span>
                {control.posture !== null && <PostureChips posture={control.posture} />}
              </span>
              <IconButton
                type="button"
                priority="tertiary"
                size="sm"
                aria-label={t`Remove ${controlName}`}
                icon={<X aria-hidden="true" className="size-3.5" />}
                onClick={() => onRemove(control.capabilityId)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
};

interface LineFormProps {
  reviewId: string,
  organizationId: string,
  periodStart: string,
  periodEnd: string,
  line: ReviewLine | null,
  initialNature: BudgetLineNature,
  postures: ControlPostures | undefined,
}

const BudgetReviewLineForm: FunctionComponent<LineFormProps> = ({ reviewId, organizationId, periodStart, periodEnd, line, initialNature, postures }) => {
  const trpc = useTRPC();
  const { toast } = useToast();
  const { closeDrawer } = useFormDrawerContext();
  const initialControls = line?.capabilityIds ?? [];
  const [selected, setSelected] = useState<Array<string>>(initialControls);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const form = useForm<LineValues>({
    resolver: zodResolver(lineSchema),
    defaultValues: {
      name: line?.name ?? '',
      nature: line?.nature ?? initialNature,
      amountSpent: line?.amountSpent ?? null,
      amortizationYears: line === null ? DEFAULT_AMORTIZATION_YEARS : line.amortizationYears,
    },
  });
  const formState = useFormState({ control: form.control });
  const nature = useWatch({ control: form.control, name: 'nature' });
  const controls = postures?.controls ?? [];
  const choices = buildLineChoices(controls, line?.id ?? null, selected);

  useFormDrawerDirtyState(formState.isDirty || !sameControls(selected, initialControls));

  const createLine = useMutation(trpc.budgetReviews.createBudgetReviewLine.mutationOptions({ meta: { skipSuccessToast: true } }));
  const updateLine = useMutation(trpc.budgetReviews.updateBudgetReviewLine.mutationOptions({ meta: { skipSuccessToast: true } }));
  const deleteLine = useMutation(trpc.budgetReviews.deleteBudgetReviewLines.mutationOptions({ meta: { skipSuccessToast: true } }));

  const save = async (values: LineValues) => {
    const payload = {
      name: values.name,
      nature: values.nature,
      amountSpent: values.amountSpent ?? 0,
      amortizationYears: values.nature === 'build' ? values.amortizationYears : null,
      capabilityIds: linePayloadControls(values.nature, selected, choices),
    };
    if (line === null) {
      await createLine.mutateAsync({ reviewId, values: payload });
      toast({ description: t`Budget line created successfully.` });
    } else {
      await updateLine.mutateAsync({ id: line.id, values: payload });
      toast({ description: t`Budget line updated successfully.` });
    }
    closeDrawer();
  };

  const toggle = (capabilityId: string) => setSelected((current) => (current.includes(capabilityId)
    ? current.filter((id) => id !== capabilityId)
    : [...current, capabilityId]));

  return (
    <>
      <DrawerFormColumn
        onSubmit={(event) => {
          if (!isDeliberateSubmit(event.nativeEvent.submitter)) {
            event.preventDefault();
            return;
          }
          // Each write raises its own error toast; catching here only keeps the rejection handled.
          void form.handleSubmit((values) => void save(values).catch(() => undefined))(event);
        }}
      >
        <DrawerFormBody>
          <Controller
            control={form.control}
            name="name"
            render={({ field, fieldState }) => (
              <Input {...field} label={t`Name`} required error={fieldState.error?.message} />
            )}
          />
          <Controller
            control={form.control}
            name="nature"
            render={({ field }) => (
              <div role="group" aria-label={t`Nature`} className="flex flex-col gap-1.5">
                <span className="txt-sub-content">{t`Nature`} *</span>
                <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
                  {NATURES.map((option) => (
                    <SelectableCard key={option} selected={field.value === option} onToggle={() => field.onChange(option)}>
                      {lineNatureLabel(option)}
                    </SelectableCard>
                  ))}
                </div>
              </div>
            )}
          />
          <div className={cn('grid gap-4', nature === 'build' && 'grid-cols-[repeat(2,minmax(0,1fr))]')}>
            <Controller
              control={form.control}
              name="amountSpent"
              render={({ field, fieldState }) => (
                <FormattedNumberInput
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  label={t`Spent over the period`}
                  required
                  error={fieldState.error === undefined ? undefined : t`Enter what this line cost over the period.`}
                />
              )}
            />
            {nature === 'build' && (
              <Controller
                control={form.control}
                name="amortizationYears"
                render={({ field, fieldState }) => (
                  <NumberFormInput
                    value={field.value ?? undefined}
                    onChange={(next) => field.onChange(next ?? null)}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    min={1}
                    max={BUDGET_LINE_MAX_AMORTIZATION_YEARS}
                    step={1}
                    label={t`Amortized over (years)`}
                    error={fieldState.error === undefined ? undefined : t`Between 1 and ${maxYears} whole years, or empty for the full spend.`}
                  />
                )}
              />
            )}
          </div>
          {nature === 'build'
            ? (
              <BuildControls
                controls={controls}
                lineId={line?.id ?? null}
                periodStart={periodStart}
                periodEnd={periodEnd}
                selected={selected}
                onToggle={toggle}
              />
            )
            : (
              <RunControls
                reviewId={reviewId}
                organizationId={organizationId}
                controls={controls}
                selected={selected}
                onAdd={(capabilityId) => setSelected((current) => [...current, capabilityId])}
                onRemove={(capabilityId) => setSelected((current) => current.filter((id) => id !== capabilityId))}
              />
            )}
        </DrawerFormBody>
        <DrawerFormActions
          isPending={createLine.isPending || updateLine.isPending}
          submitLabel={line === null ? t`Create` : t`Save`}
          destructiveAction={line === null ? undefined : {
            label: t`Delete`,
            isPending: deleteLine.isPending,
            onClick: () => setConfirmingDelete(true),
          }}
        />
      </DrawerFormColumn>
      {line !== null && (
        <DeleteConfirmDialog
          open={confirmingDelete}
          onOpenChange={setConfirmingDelete}
          onConfirm={() => deleteLine.mutate([line.id], {
            onSuccess: () => {
              toast({ description: t`Budget line deleted successfully.` });
              closeDrawer();
            },
          })}
          title={<Trans>Delete budget line</Trans>}
          description={<Trans>This will permanently delete this budget line. The review's figures expire until its scenarios are simulated again.</Trans>}
        />
      )}
    </>
  );
};

interface BudgetReviewLineDrawerProps extends LineFormProps {
  open: boolean,
  onOpenChange: (open: boolean) => void,
}

/**
 * One drawer for both natures, switched by the nature cards: a build line picks among the period's
 * moves, a run line among every control of the scope. No amount per control: a line is priced as
 * one basket, and stacked controls return less than their sum.
 */
export const BudgetReviewLineDrawer: FunctionComponent<BudgetReviewLineDrawerProps> = ({ open, onOpenChange, line, ...props }) => (
  <FormDrawer
    open={open}
    onClose={() => onOpenChange(false)}
    title={line === null ? t`Add a budget line` : t`Edit the budget line`}
  >
    {open && <BudgetReviewLineForm line={line} {...props} />}
  </FormDrawer>
);
