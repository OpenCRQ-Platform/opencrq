import { t } from '@lingui/core/macro';
import type { ToleranceReference } from '../budget-review-tolerance-utils';

export const referenceLegend = (reference: ToleranceReference): string => {
  switch (reference) {
    case 'today': return t`Today`;
    case 'period-end': return t`At the fiscal year end`;
    case 'closing': return t`At closing`;
  }
};

export const outsideAtReferenceLabel = (reference: ToleranceReference): string => {
  switch (reference) {
    case 'today': return t`Outside tolerance today`;
    case 'period-end': return t`Outside tolerance at the fiscal year end`;
    case 'closing': return t`Outside tolerance at closing`;
  }
};

export const probabilityAtReferenceLabel = (reference: ToleranceReference): string => {
  switch (reference) {
    case 'today': return t`Probability of exceeding today`;
    case 'period-end': return t`Probability of exceeding at the fiscal year end`;
    case 'closing': return t`Probability of exceeding at closing`;
  }
};

export const readAtReferenceLabel = (reference: ToleranceReference, probability: string): string => {
  switch (reference) {
    case 'today': return t`${probability} today`;
    case 'period-end': return t`${probability} at the fiscal year end`;
    case 'closing': return t`${probability} at closing`;
  }
};
