import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { Button } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { inferRouterOutputs } from '@trpc/server';
import { PencilIcon } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { CardField, SectionCard } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { formatDollar } from '../../../utils/format-currency';
import { AleReduction } from '../ui/ale-reduction';
import { ExpiredChip } from '../ui/plan-chips';
import { PlanReturn } from '../ui/plan-return';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type PlanProjection = NonNullable<RouterOutputs['treatmentPlans']['getTreatmentPlanProjection']>;

interface TreatmentPlanReturnCardProps {
  costOneOff: number | null,
  costRecurringAnnual: number | null,
  /** Undefined while it loads. */
  projection: PlanProjection | undefined,
  onEditCost: () => void,
}

/**
 * The return and the first-year cost are read from the projection, never derived from the two
 * cost props, so this card and the list cannot disagree. No spread on the total: percentiles do
 * not add up.
 */
export const TreatmentPlanReturnCard: FunctionComponent<TreatmentPlanReturnCardProps> = ({
  costOneOff,
  costRecurringAnnual,
  projection,
  onEditCost,
}) => {
  const hasCost = costOneOff !== null || costRecurringAnnual !== null;
  const costYear1 = projection?.costYear1 ?? null;

  return (
    <SectionCard
      title={(
        <span className="inline-flex items-center gap-2">
          <Trans>Cost and return</Trans>
          {projection?.expired === true && <ExpiredChip />}
        </span>
      )}
      headerAction={(
        <Button priority="tertiary" size="sm" startIcon={<PencilIcon className="size-3" />} onClick={onEditCost}>
          {hasCost ? <Trans>Edit the cost</Trans> : <Trans>Enter the cost</Trans>}
        </Button>
      )}
      contentClassName="grid grid-cols-1 gap-6 md:grid-cols-3"
    >
      <CardField title={t`One-year return`}>
        <p className="txt-title font-semibold">
          <PlanReturn value={projection?.returnPercent ?? null} />
        </p>
      </CardField>
      <CardField title={t`Annual ALE reduction`}>
        <p className="txt-title font-semibold">
          <AleReduction value={projection?.totalAleReduction ?? null} />
        </p>
      </CardField>
      <CardField title={t`First-year cost`}>
        <p className="txt-title font-semibold">
          {costYear1 === null ? <EmptyValue /> : formatDollar(costYear1)}
        </p>
      </CardField>
    </SectionCard>
  );
};
