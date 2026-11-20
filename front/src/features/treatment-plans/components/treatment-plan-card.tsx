import type { TreatmentPlanStatus } from '@app/module/client';
import { Card, CardHeader, CardTitle, ProgressBar, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { EllipsisVertical } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { EmptyValue } from '../../../components/ui/empty-value';
import { CARD_CONTENT_FILLS } from '../../../components/ui/card-content-fills';
import { formatDate } from '../../../utils';
import { formatDollar } from '../../../utils/format-currency';
import { AleReduction } from '../ui/ale-reduction';
import { ExpiredChip, OverdueChip, PlanStatusChip } from '../ui/plan-chips';
import { PlanReturn } from '../ui/plan-return';
import { isOverdue, planElapsedPercent } from '../treatment-plan-utils';

export interface TreatmentPlanCardPlan {
  id: string,
  name: string,
  status: TreatmentPlanStatus,
  owner: { name: string | null } | null,
  startDate: string | null,
  endDate: string | null,
  costYear1: number | null,
  totalAleReduction: number | null,
  returnPercent: number | null,
  expired: boolean,
}

interface FigureRowProps {
  label: ReactNode,
  children: ReactNode,
}

const FigureRow: FunctionComponent<FigureRowProps> = ({ label, children }) => (
  <div className="flex items-baseline justify-between gap-2">
    <Text as="dt" variant="content-compact" className="truncate text-default-secondary">{label}</Text>
    <Text as="dd" variant="content-compact" className="m-0 shrink-0 tabular-nums">{children}</Text>
  </div>
);

interface TreatmentPlanCardProps {
  plan: TreatmentPlanCardPlan,
  onNavigate: (id: string) => void,
  onDelete: (id: string) => void,
}

export const TreatmentPlanCard: FunctionComponent<TreatmentPlanCardProps> = ({ plan, onNavigate, onDelete }) => {
  const overdue = isOverdue(plan.endDate);
  const due = plan.endDate === null ? null : formatDate(plan.endDate);

  return (
    <Card gap={16} padding={16} className={`h-full ${CARD_CONTENT_FILLS}`} data-testid="treatment-plan-card" onClick={() => onNavigate(plan.id)}>
      <CardHeader
        action={(
          <IconActions icon={<EllipsisVertical className="h-4 w-4 text-primary" />}>
            <IconActionsItem onClick={() => onDelete(plan.id)}>
              <Trans>Delete</Trans>
            </IconActionsItem>
          </IconActions>
        )}
      >
        <CardTitle as="h3">{plan.name}</CardTitle>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <PlanStatusChip status={plan.status} />
          {overdue && <OverdueChip />}
        </span>
      </CardHeader>
      {/* Pushed to the bottom of a card the grid stretched to its row's tallest, so the figures of
          one row line up whatever the length of each name. */}
      <div className="mt-auto flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <Text as="span" variant="content-caption" className="text-default-secondary"><Trans>Return</Trans></Text>
          <Text as="span" variant="title-xl" className={plan.returnPercent === null ? 'text-default-secondary' : undefined}>
            <PlanReturn value={plan.returnPercent} />
          </Text>
        </div>
        <dl className="m-0 flex flex-col gap-1.5">
          <FigureRow label={<Trans>First-year cost</Trans>}>
            {plan.costYear1 === null ? <EmptyValue /> : formatDollar(plan.costYear1)}
          </FigureRow>
          <FigureRow label={<Trans>ALE reduction</Trans>}>
            <AleReduction value={plan.totalAleReduction} />
          </FigureRow>
        </dl>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-[color:var(--fds-border-elevation-subtle-soft)] pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <Text as="span" variant="content-caption" className="truncate text-default-secondary">
              {plan.owner?.name ?? <EmptyValue />}
            </Text>
            {plan.expired && <ExpiredChip />}
          </span>
          <Text
            as="span"
            variant="content-caption"
            className={overdue ? 'shrink-0 text-[color:var(--fds-color-feedback-error-tertiary)]' : 'shrink-0 text-default-secondary'}
          >
            {due === null ? <Trans>No due date</Trans> : <Trans>Due {due}</Trans>}
          </Text>
        </div>
        <ProgressBar
          aria-label={t`Time elapsed from the start date to the due date`}
          value={planElapsedPercent(plan.startDate, plan.endDate)}
          tone={overdue ? 'error' : 'default'}
        />
      </div>
    </Card>
  );
};
