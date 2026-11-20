import { Chip } from '@filigran/design-system';
import type { ChipSeverity } from '@filigran/design-system';
import type { TreatmentPlanStatus } from '@app/module/client';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';

const STATUS_SEVERITY: Record<TreatmentPlanStatus, ChipSeverity> = {
  draft: 'neutral',
  active: 'info',
  completed: 'low',
  abandoned: 'neutral',
};

export const planStatusLabel = (status: TreatmentPlanStatus): string => {
  switch (status) {
    case 'draft': return t`Draft`;
    case 'active': return t`Active`;
    case 'completed': return t`Completed`;
    case 'abandoned': return t`Abandoned`;
  }
};

export const PlanStatusChip: FunctionComponent<{ status: TreatmentPlanStatus }> = ({ status }) => (
  <Chip severity={STATUS_SEVERITY[status]} label={planStatusLabel(status)} />
);

export const OverdueChip: FunctionComponent = () => <Chip severity="critical" label={t`Overdue`} />;

/**
 * A figure priced against a set of moves the plan has since changed. Not `critical`, which the
 * overdue chip beside it owns: an expired figure dates the reading, it does not fault the plan.
 */
export const ExpiredChip: FunctionComponent = () => <Chip severity="medium" label={t`Expired`} />;

export const OlderThanAleChip: FunctionComponent = () => <Chip severity="neutral" label={t`Older than the ALE`} />;
