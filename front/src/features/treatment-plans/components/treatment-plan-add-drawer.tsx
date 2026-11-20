import { zodResolver } from '@hookform/resolvers/zod';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { skipToken, useMutation, useQuery } from '@tanstack/react-query';
import type { CandidateRow, CandidateTarget, MoveRow } from './treatment-plan-move-columns';
import type { HeldPlanMove, PlanLever } from '../treatment-plan-utils';
import type { FunctionComponent, ReactNode } from 'react';
import { useRef, useState } from 'react';
import { useForm, useFormState } from 'react-hook-form';
import {
  DrawerFormActions,
  DrawerFormBody,
  DrawerFormColumn,
  FormDrawer,
  InfoTooltip,
  SingleSelectField,
  useFormDrawerContext,
  useFormDrawerDirtyState,
} from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { useTRPC } from '../../../lib';
import { coverageLabel } from '../../controls/capability/ui/coverage-label';
import { strengthLabel } from '../../controls/capability/ui/strength-label';
import { PlanMoveWarningHint } from '../ui/plan-move-warning';
import {
  bestPlanGain,
  keptPlanTargets,
  leverPrefills,
  mergedPlanRow,
  PLAN_MOVE_AXES,
  planAxisGain,
  planMoveRows,
  planMoveWarning,
  planScopePayload,
  prefilledTargets,
} from '../treatment-plan-utils';
import {
  emptyTreatmentPlanValues,
  TreatmentPlanIdentityFields,
  treatmentPlanIdentitySchema,
} from './treatment-plan-create-drawer';
import { planDrawerClassName } from './treatment-plan-drawer';
import { GAIN_FIRST, planMoveColumns } from './treatment-plan-move-columns';

const NEW_PLAN = 'new';

const keptTargetsLabel = (kept: HeldPlanMove): string => {
  const strength = kept.targetStrengthRung === null ? null : strengthLabel(kept.targetStrengthRung);
  const coverage = kept.targetCoverageBucket === null ? null : coverageLabel(kept.targetCoverageBucket);
  const sentences = [
    strength === null ? null : t`Its strength target, ${strength}, is kept.`,
    coverage === null ? null : t`Its coverage target, ${coverage}, is kept.`,
  ].filter((sentence) => sentence !== null);
  return sentences.length === 0
    ? t`Already in this plan: these targets replace the ones it holds.`
    : [t`Already in this plan.`, ...sentences].join(' ');
};

interface TreatmentPlanAddFormProps {
  organizationId: string,
  levers: Array<PlanLever>,
  onAdded: () => void,
}

const TreatmentPlanAddForm: FunctionComponent<TreatmentPlanAddFormProps> = ({ organizationId, levers, onAdded }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const [planChoice, setPlanChoice] = useState<string | null>(null);
  const [choiceMissing, setChoiceMissing] = useState(false);
  const planSelectRef = useRef<HTMLInputElement>(null);
  const [overrides, setOverrides] = useState<Record<string, CandidateTarget>>({});

  const form = useForm({
    resolver: zodResolver(treatmentPlanIdentitySchema),
    defaultValues: emptyTreatmentPlanValues(organizationId),
  });
  const identityState = useFormState({ control: form.control });

  const { data: plans } = useQuery(trpc.treatmentPlans.getTreatmentPlans.queryOptions({ organizationId }));
  // A scope holding no plan leaves nothing else to choose.
  const choice = planChoice ?? (plans?.length === 0 ? NEW_PLAN : null);
  const chosenPlanId = choice === null || choice === NEW_PLAN ? null : choice;

  const { data: candidates, isLoading } = useQuery(trpc.treatmentPlans.getScopeTreatmentPlanCandidates.queryOptions({ organizationId }));
  const { data: heldMoves } = useQuery(trpc.treatmentPlans.getTreatmentPlanMoves.queryOptions(
    chosenPlanId === null ? skipToken : { planId: chosenPlanId },
  ));
  const heldByCapability = new Map((heldMoves ?? []).map((move) => [move.capabilityId, move]));

  const prefills = leverPrefills(levers);
  const rows: Array<CandidateRow> = (candidates ?? []).flatMap((candidate) => {
    const prefill = prefills.get(candidate.capabilityId);
    return prefill === undefined
      ? []
      : [{ ...candidate, ...prefilledTargets(candidate, prefill), ...overrides[candidate.capabilityId], id: candidate.capabilityId }];
  });
  const moveRows = planMoveRows(rows).filter((row) => prefills.get(row.capabilityId)?.axes.includes(row.axis) === true);
  const moves = planScopePayload(rows);

  // Read against the whole scope, as the plan's own drawer reads it, so a rating means the same
  // thing in both.
  const bestGain = bestPlanGain((candidates ?? []).flatMap((candidate) => PLAN_MOVE_AXES.map((axis) => planAxisGain(candidate, axis))));

  useFormDrawerDirtyState(identityState.isDirty || planChoice !== null || Object.keys(overrides).length > 0);

  const createPlan = useMutation(trpc.treatmentPlans.createTreatmentPlan.mutationOptions({
    meta: { successMessage: msg`Treatment plan created successfully.` },
  }));
  const addMoves = useMutation(trpc.treatmentPlans.addTreatmentPlanMoves.mutationOptions({
    meta: { successMessage: msg`Controls added to the treatment plan.` },
  }));

  const done = () => {
    closeDrawer();
    onAdded();
  };

  const submit = () => {
    if (choice === null) {
      setChoiceMissing(true);
      planSelectRef.current?.focus();
      return;
    }
    if (choice === NEW_PLAN) {
      void form.handleSubmit((values) => createPlan.mutate({ ...values, organizationId, moves }, { onSuccess: done }))();
      return;
    }
    addMoves.mutate({ planId: choice, moves }, { onSuccess: done });
  };

  const columns = planMoveColumns({
    bestGain,
    onChange: (capabilityId, next) => setOverrides((current) => ({ ...current, [capabilityId]: next })),
    targetHints: (row: MoveRow): ReactNode => {
      const held = heldByCapability.get(row.capabilityId);
      const warning = planMoveWarning(mergedPlanRow(row, held), row.axis);
      const keptLabel = held === undefined ? null : keptTargetsLabel(keptPlanTargets(row, held));
      return (
        <>
          {warning !== null && <PlanMoveWarningHint warning={warning} />}
          {/* Above: flipped left for lack of room, it would cover the target menu. */}
          {keptLabel !== null && <InfoTooltip label={keptLabel} side="top">{keptLabel}</InfoTooltip>}
        </>
      );
    },
  });

  return (
    <DrawerFormColumn
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DrawerFormBody>
        <SingleSelectField
          options={[
            ...(plans ?? []).map((plan) => ({ label: plan.name, value: plan.id })),
            { label: t`New plan`, value: NEW_PLAN },
          ]}
          value={choice}
          onChange={(next) => {
            setPlanChoice(next);
            setChoiceMissing(false);
          }}
          inputRef={planSelectRef}
          label={t`Treatment plan`}
          required
          placeholder={t`Select a treatment plan`}
          emptyMessage={t`No treatment plan found`}
          error={choiceMissing ? t`Choose a plan, or create a new one.` : undefined}
        />

        {choice === NEW_PLAN && <TreatmentPlanIdentityFields control={form.control} />}

        <span className="txt-category"><Trans>Controls</Trans></span>
        <DataPageLayout
          data={moveRows}
          columns={columns}
          isLoading={isLoading}
          storageKey="treatmentPlanAddMoves"
          initialSorting={GAIN_FIRST}
          hideToolbar
        />
      </DrawerFormBody>

      <DrawerFormActions
        isPending={createPlan.isPending || addMoves.isPending}
        submitLabel={choice === NEW_PLAN ? t`Create` : t`Add to plan`}
        disabled={choice !== NEW_PLAN && moves.length === 0}
      />
    </DrawerFormColumn>
  );
};

interface TreatmentPlanAddDrawerProps {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  /** The risk scope of the scenario the levers were picked on, which is the only scope a plan can hold them in. */
  organizationId: string,
  levers: Array<PlanLever>,
  onAdded: () => void,
}

/**
 * No amount per control: a lever was priced on one scenario and a plan is priced over every
 * scenario of its scope, so a figure here would state neither.
 */
export const TreatmentPlanAddDrawer: FunctionComponent<TreatmentPlanAddDrawerProps> = ({
  open,
  onOpenChange,
  organizationId,
  levers,
  onAdded,
}) => (
  <FormDrawer
    open={open}
    onClose={() => onOpenChange(false)}
    title={t`Add to a treatment plan`}
    className={planDrawerClassName}
  >
    {/* Mounted per opening, so each one starts on the levers it was opened with. */}
    {open && <TreatmentPlanAddForm organizationId={organizationId} levers={levers} onAdded={onAdded} />}
  </FormDrawer>
);
