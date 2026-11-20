import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { ActivityHistoryEntry } from '../../supporting-assets/components/finding-activity-chart';
import { FindingActivityChart } from '../../supporting-assets/components/finding-activity-chart';
import { DossierCard } from './dossier-card';

interface FindingActivityCardProps {
  history: Array<ActivityHistoryEntry>,
  className?: string,
}

/**
 * One drawing for one reading, used identically on Overview and on Activity: how long the finding
 * has been in the state it is in.
 */
export const FindingActivityCard: FunctionComponent<FindingActivityCardProps> = ({ history, className }) => (
  <DossierCard label={t`State over the last 12 months`} className={className}>
    <FindingActivityChart history={history} kind="cve" />
  </DossierCard>
);
