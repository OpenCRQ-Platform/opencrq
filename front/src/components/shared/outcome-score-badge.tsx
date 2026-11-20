import { MODERATE_OUTCOME_MATCH_SCORE, STRONG_OUTCOME_MATCH_SCORE } from '@app/module/client';
import { Chip } from '@filigran/design-system';
import type { FunctionComponent } from 'react';
import { formatOutcomeProbability } from '../../utils/outcome-probability-utils';
import { EmptyValue } from '../ui/empty-value';

export const outcomeScoreSeverity = (score: number): 'critical' | 'high' | 'low' => {
  if (score >= STRONG_OUTCOME_MATCH_SCORE) {
    return 'critical';
  }
  return score >= MODERATE_OUTCOME_MATCH_SCORE ? 'high' : 'low';
};

export const OutcomeScoreBadge: FunctionComponent<{ score: number }> = ({ score }) => {
  if (score === 0) {
    return <EmptyValue />;
  }
  return <Chip severity={outcomeScoreSeverity(score)} label={formatOutcomeProbability(score)} />;
};
