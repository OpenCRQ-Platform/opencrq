import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { Button } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import type { inferRouterOutputs } from '@trpc/server';
import { ArrowLeft } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { TreatmentPlanDrawerTab } from './treatment-plan-drawer';
import { CardField, DescriptionField, DetailPageLayout, InfoField, SectionCard } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { formatDate } from '../../../utils';
import { isOverdue, resimulationControl } from '../treatment-plan-utils';
import { OverdueChip, PlanStatusChip } from '../ui/plan-chips';
import { TreatmentPlanControlsCard } from './treatment-plan-controls-card';
import { TreatmentPlanDrawer } from './treatment-plan-drawer';
import { TreatmentPlanReturnCard } from './treatment-plan-return-card';
import { TreatmentPlanScenariosCard } from './treatment-plan-scenarios-card';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type TreatmentPlan = NonNullable<RouterOutputs['treatmentPlans']['getTreatmentPlan']>;

interface TreatmentPlanPageProps {
  plan: TreatmentPlan,
}

/**
 * One label over one value, and a field the plan leaves empty still holds its place: what a plan
 * names and what it has yet to name are read in the same glance.
 */
const PlanIdentityCard: FunctionComponent<{ plan: TreatmentPlan }> = ({ plan }) => (
  <SectionCard title={<Trans>Identity</Trans>} contentClassName="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
    <CardField title={t`Scope`}>
      <Link
        from="/$tenantId/{-$organizationId}"
        to="."
        params={(previous) => ({ ...previous, organizationId: plan.organizationId })}
        className="text-primary underline-offset-4 hover:underline"
      >
        {plan.organization.name}
      </Link>
    </CardField>
    <InfoField title={t`Owner`} value={plan.owner?.name} />
    <InfoField title={t`Start date`} value={plan.startDate === null ? null : formatDate(plan.startDate)} />
    <InfoField title={t`Due date`} value={plan.endDate === null ? null : formatDate(plan.endDate)} />
    <DescriptionField title={t`Rationale`} value={plan.rationale} className="col-span-2 lg:col-span-4" />
  </SectionCard>
);

/**
 * One page of stacked cards rather than tabs: the moves a plan makes and what they are priced to
 * buy are one reading, so neither can sit behind a tab the other is not on.
 */
export const TreatmentPlanPage: FunctionComponent<TreatmentPlanPageProps> = ({ plan }) => {
  const trpc = useTRPC();
  const [editing, setEditing] = useState<TreatmentPlanDrawerTab | null>(null);
  const { data: projection } = useQuery(trpc.treatmentPlans.getTreatmentPlanProjection.queryOptions({ planId: plan.id }));
  const { data: simulationState, refetch: refetchSimulationState } = useQuery(trpc.treatmentPlans.getTreatmentPlanSimulationState.queryOptions({ planId: plan.id }));
  const { mutate: resimulate, isPending: isResimulating } = useMutation(trpc.treatmentPlans.resimulateTreatmentPlanScenarios.mutationOptions({
    meta: { skipSuccessToast: true },
    // The doorbell may answer before this does, and an enqueue that queued nothing writes nothing for it to ring
    // on, so the mutation stays pending until the state it leaves behind has been read.
    onSuccess: () => refetchSimulationState(),
  }));
  const resimulation = resimulationControl(simulationState, isResimulating);

  return (
    <>
      <DetailPageLayout
        title={plan.name}
        titleLeading={(
          <Link
            from="/$tenantId/{-$organizationId}"
            to="treatment-plans"
            aria-label={t`Back to the treatment plans`}
            className="inline-flex h-8 w-8 items-center justify-center text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
        actions={(
          <div className="flex items-center gap-2">
            <PlanStatusChip status={plan.status} />
            {isOverdue(plan.endDate) && <OverdueChip />}
            <Button priority="secondary" onClick={() => setEditing('identity')}>
              <Trans>Edit</Trans>
            </Button>
          </div>
        )}
      >
        <PlanIdentityCard plan={plan} />
        <TreatmentPlanReturnCard
          costOneOff={plan.costOneOff}
          costRecurringAnnual={plan.costRecurringAnnual}
          projection={projection ?? undefined}
          onEditCost={() => setEditing('identity')}
        />
        <TreatmentPlanControlsCard planId={plan.id} onEditControls={() => setEditing('controls')} />
        {projection && (
          <TreatmentPlanScenariosCard
            projection={projection}
            resimulation={resimulation}
            onResimulate={() => resimulate({ planId: plan.id })}
          />
        )}
      </DetailPageLayout>
      <TreatmentPlanDrawer
        open={editing !== null}
        onOpenChange={(open) => setEditing(open ? 'identity' : null)}
        plan={plan}
        initialTab={editing ?? 'identity'}
      />
    </>
  );
};
