import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { BudgetLineNature } from '../budget-review-utils';
import { ExpiredChip } from '../../treatment-plans/ui/plan-chips';

export type BudgetReviewStatus = 'open' | 'closed';
export type BudgetReviewFigureState = 'priced' | 'expired' | 'not-priced';

const reviewStatusLabel = (status: BudgetReviewStatus): string => {
  switch (status) {
    case 'open': return t({ message: 'Open', context: 'budget review status' });
    case 'closed': return t({ message: 'Closed', context: 'budget review status' });
  }
};

export const ReviewStatusChip: FunctionComponent<{ status: BudgetReviewStatus }> = ({ status }) => (
  <Chip severity={status === 'open' ? 'info' : 'neutral'} label={reviewStatusLabel(status)} />
);

export const lineNatureLabel = (nature: BudgetLineNature): string => {
  switch (nature) {
    case 'build': return t({ message: 'Build', context: 'budget line nature' });
    case 'run': return t({ message: 'Run', context: 'budget line nature' });
  }
};

export const LineNatureChip: FunctionComponent<{ nature: BudgetLineNature }> = ({ nature }) => (
  <Chip severity={nature === 'build' ? 'info' : 'neutral'} label={lineNatureLabel(nature)} />
);

const NotPricedChip: FunctionComponent = () => <Chip severity="neutral" label={t`Not priced`} />;

/** Nothing for a priced figure: only a figure that is out of date or missing needs saying so. */
export const FigureStateChip: FunctionComponent<{ state: BudgetReviewFigureState }> = ({ state }) => {
  switch (state) {
    case 'priced': return null;
    case 'expired': return <ExpiredChip />;
    case 'not-priced': return <NotPricedChip />;
  }
};
