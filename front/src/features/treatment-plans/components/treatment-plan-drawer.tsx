import { includesFolded } from '@app/utils/text-fold';
import { Input, SearchField, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@filigran/design-system';
import { useToast } from '@filigran/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { CandidateRow, CandidateTarget } from './treatment-plan-move-columns';
import type { FunctionComponent } from 'react';
import { useRef, useState } from 'react';
import { Controller, useForm, useFormState } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  DateFormInput,
  DrawerFormActions,
  DrawerFormBody,
  DrawerFormColumn,
  FormattedNumberInput,
  FormDrawer,
  isDeliberateSubmit,
  OwnerSelect,
  useFormDrawerContext,
  useFormDrawerDirtyState,
} from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { useTRPC } from '../../../lib';
import { PlanMoveWarningHint } from '../ui/plan-move-warning';
import {
  bestPlanGain,
  isPlanScopeDirty,
  PLAN_MOVE_AXES,
  planAxisGain,
  planMoveRows,
  planMoveWarning,
  planScopePayload,
} from '../treatment-plan-utils';
import { GAIN_FIRST, planMoveColumns } from './treatment-plan-move-columns';

export type TreatmentPlanDrawerTab = 'identity' | 'controls';

const CANDIDATES_TABLE_ID = 'treatmentPlanCandidates';

// The legacy sheet's own right-side width is declared at the `md` breakpoint, so an unprefixed
// width here would lose to it on every desktop viewport.
export const planDrawerClassName = 'max-md:w-full md:w-[70vw] max-w-[1280px] min-w-[min(860px,100vw)]';

const formSchema = z.object({
  name: z.string().trim().min(1),
  ownerId: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  rationale: z.string().nullable(),
  costOneOff: z.number().min(0).nullable(),
  costRecurringAnnual: z.number().min(0).nullable(),
});

type FormValues = z.infer<typeof formSchema>;

export interface EditableTreatmentPlan {
  id: string,
  name: string,
  ownerId: string | null,
  startDate: string | null,
  endDate: string | null,
  rationale: string | null,
  costOneOff: number | null,
  costRecurringAnnual: number | null,
}

const valuesOf = (plan: EditableTreatmentPlan): FormValues => ({
  name: plan.name,
  ownerId: plan.ownerId,
  startDate: plan.startDate,
  endDate: plan.endDate,
  rationale: plan.rationale,
  costOneOff: plan.costOneOff,
  costRecurringAnnual: plan.costRecurringAnnual,
});

interface ControlsTabProps {
  rows: Array<CandidateRow>,
  isLoading: boolean,
  onChange: (capabilityId: string, next: CandidateTarget) => void,
}

const ControlsTab: FunctionComponent<ControlsTabProps> = ({ rows, isLoading, onChange }) => {
  const [search, setSearch] = useState('');

  // Read against every lever of every candidate rather than the ones the search leaves, so a
  // rating means the same thing whatever is typed above it.
  const bestGain = bestPlanGain(rows.flatMap((row) => PLAN_MOVE_AXES.map((axis) => planAxisGain(row, axis))));
  const matching = rows.filter((row) => includesFolded(row.name, search) || includesFolded(row.externalId, search));
  const visible = planMoveRows(matching);

  const columns = planMoveColumns({
    bestGain,
    onChange,
    targetHints: (row) => {
      const warning = planMoveWarning(row, row.axis);
      return warning !== null && <PlanMoveWarningHint warning={warning} />;
    },
  });

  return (
    <DataPageLayout
      data={visible}
      columns={columns}
      isLoading={isLoading}
      storageKey={CANDIDATES_TABLE_ID}
      initialSorting={GAIN_FIRST}
      leftHeaderContent={(
        <SearchField
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onClear={() => setSearch('')}
          clearLabel={t`Clear the search`}
          aria-label={t`Search for a control`}
          placeholder={t`Search for a control`}
          className="w-80"
        />
      )}
    />
  );
};

interface TreatmentPlanDrawerBodyProps {
  plan: EditableTreatmentPlan,
  initialTab: TreatmentPlanDrawerTab,
}

/** Mounted per opening, so the tab it starts on is the one the opener asked for, every time. */
const TreatmentPlanDrawerBody: FunctionComponent<TreatmentPlanDrawerBodyProps> = ({ plan, initialTab }) => {
  const trpc = useTRPC();
  const [tab, setTab] = useState<TreatmentPlanDrawerTab>(initialTab);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Both panels share one scroller, which would carry the previous tab's offset over.
  const changeTab = (next: TreatmentPlanDrawerTab) => {
    setTab(next);
    if (next !== tab) {
      bodyRef.current?.scrollTo({ top: 0 });
    }
  };
  const { toast } = useToast();
  const { closeDrawer } = useFormDrawerContext();
  const [overrides, setOverrides] = useState<Record<string, CandidateTarget>>({});

  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: valuesOf(plan) });
  const identityState = useFormState({ control: form.control });

  const { data: candidates, isLoading } = useQuery(trpc.treatmentPlans.getTreatmentPlanCandidates.queryOptions({ planId: plan.id }));

  const initial = candidates ?? [];

  // Derived during render rather than mirrored into state, so a candidate list that resolves after
  // mount, or is refreshed under the drawer, never overwrites an edit in progress.
  const rows: Array<CandidateRow> = initial
    .map((candidate) => ({ ...candidate, ...overrides[candidate.capabilityId], id: candidate.capabilityId }));

  const scopeDirty = isPlanScopeDirty(rows, initial);
  useFormDrawerDirtyState(identityState.isDirty || scopeDirty);

  const updatePlan = useMutation(trpc.treatmentPlans.updateTreatmentPlan.mutationOptions({ meta: { skipSuccessToast: true } }));
  const setScope = useMutation(trpc.treatmentPlans.setTreatmentPlanScope.mutationOptions({ meta: { skipSuccessToast: true } }));

  // One press writes the identity and the controls, and raises one toast for the pair.
  const save = async (values: FormValues) => {
    // The Enter key submits from any field, footer button disabled or not, so a save with nothing
    // to write must not announce one.
    if (!identityState.isDirty && !scopeDirty) {
      closeDrawer();
      return;
    }
    if (identityState.isDirty) {
      await updatePlan.mutateAsync({ id: plan.id, values });
    }
    if (scopeDirty) {
      await setScope.mutateAsync({ planId: plan.id, moves: planScopePayload(rows) });
    }
    toast({ description: t`Treatment plan updated successfully.` });
    closeDrawer();
  };

  return (
    <DrawerFormColumn
      onSubmit={(event) => {
        if (!isDeliberateSubmit(event.nativeEvent.submitter)) {
          event.preventDefault();
          return;
        }
        void form.handleSubmit(
          // Each write raises its own error toast; catching here only keeps the rejection handled.
          (values) => void save(values).catch(() => undefined),
          // Only the identity fields are validated, and a panel the reader cannot see cannot
          // report its own error, so the submit lands on it.
          () => changeTab('identity'),
        )(event);
      }}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => changeTab(value === 'controls' ? 'controls' : 'identity')}
        className="flex min-h-0 flex-1 flex-col gap-4"
      >
        <TabsList>
          <TabsTrigger value="identity"><Trans>Identity</Trans></TabsTrigger>
          <TabsTrigger value="controls"><Trans>Controls</Trans></TabsTrigger>
        </TabsList>

        <DrawerFormBody ref={bodyRef}>
          <TabsContent value="identity" className="flex flex-col gap-4">
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
            <div className="flex gap-4">
              <Controller
                control={form.control}
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
                control={form.control}
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
            <div className="flex gap-4">
              <Controller
                control={form.control}
                name="costOneOff"
                render={({ field, fieldState }) => (
                  <FormattedNumberInput
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    label={t`One-off cost`}
                    error={fieldState.error?.message}
                    className="flex-1"
                  />
                )}
              />
              <Controller
                control={form.control}
                name="costRecurringAnnual"
                render={({ field, fieldState }) => (
                  <FormattedNumberInput
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    label={t`Annual recurring cost`}
                    error={fieldState.error?.message}
                    className="flex-1"
                  />
                )}
              />
            </div>
            <Controller
              control={form.control}
              name="rationale"
              render={({ field, fieldState }) => (
                <Textarea
                  {...field}
                  value={field.value ?? ''}
                  onChange={(event) => field.onChange(event.target.value === '' ? null : event.target.value)}
                  rows={5}
                  label={t`Rationale`}
                  error={fieldState.error?.message}
                />
              )}
            />
          </TabsContent>

          <TabsContent value="controls" className="flex flex-col gap-4">
            <ControlsTab
              rows={rows}
              isLoading={isLoading}
              onChange={(capabilityId, next) => setOverrides((current) => ({ ...current, [capabilityId]: next }))}
            />
          </TabsContent>
        </DrawerFormBody>
      </Tabs>

      <DrawerFormActions
        isPending={updatePlan.isPending || setScope.isPending}
        disabled={!identityState.isDirty && !scopeDirty}
      />
    </DrawerFormColumn>
  );
};

interface TreatmentPlanDrawerProps {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  plan: EditableTreatmentPlan,
  /** The tab the drawer opens on: the card the reader pressed edit on is the one they want to edit. */
  initialTab?: TreatmentPlanDrawerTab,
}

/**
 * The one drawer a plan is edited in. Its two tabs are one save, so a target aimed on Controls and
 * a date moved on Identity leave together: the promise and what backs it are one arbitration.
 *
 * On Controls, naming a target on any axis is what puts a control in the plan, and setting every
 * one back to unchanged is what takes it out. The risk scope and the status are absent on purpose: a
 * plan's figures are priced against one scope, and the promise is stamped by the transition that
 * moves a plan out of `draft`, which is not this form.
 */
export const TreatmentPlanDrawer: FunctionComponent<TreatmentPlanDrawerProps> = ({ open, onOpenChange, plan, initialTab }) => {
  const planName = plan.name;
  // A default in the destructured props fails the React Compiler's build, so it lives here.
  const startTab = initialTab ?? 'identity';

  return (
    <FormDrawer
      open={open}
      onClose={() => onOpenChange(false)}
      title={t`Edit ${planName}`}
      className={planDrawerClassName}
    >
      {/* Mounted per opening, which is what starts both halves of the form back on the stored plan. */}
      {open && <TreatmentPlanDrawerBody plan={plan} initialTab={startTab} />}
    </FormDrawer>
  );
};
