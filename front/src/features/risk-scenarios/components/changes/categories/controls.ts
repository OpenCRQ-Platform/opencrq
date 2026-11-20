import { COVERAGE_BUCKETS } from '@app/module/client';
import { t } from '@lingui/core/macro';
import type { CategoryView } from './category-view';
import { coverageLabel } from '../../../../controls/capability/ui/coverage-label';
import { strengthLabel } from '../../../../controls/capability/ui/strength-label';

const bucketLabel = (value: string): string => {
  const bucket = COVERAGE_BUCKETS.find((candidate) => candidate === value);
  return bucket === undefined ? value : coverageLabel(bucket);
};

export const controlsView: CategoryView = {
  label: () => t`Controls`,
  itemName: (item) => item.label ?? item.key,
  sentence: ({ sentence, item }) => {
    const control = String(sentence.parts.control);
    const scope = String(sentence.parts.scope);
    const strengthFrom = strengthLabel(String(sentence.parts.from));
    const strengthTo = strengthLabel(String(sentence.parts.to));
    const coverageFrom = bucketLabel(String(sentence.parts.from));
    const coverageTo = bucketLabel(String(sentence.parts.to));
    switch (sentence.key) {
      case 'strength-changed':
        return t`Strength of ${control} went from ${strengthFrom} to ${strengthTo}`;
      case 'strength-changed-on-scope':
        return t`Strength of ${control} went from ${strengthFrom} to ${strengthTo} on ${scope}`;
      case 'coverage-changed':
        return t`Coverage of ${control} went from ${coverageFrom} to ${coverageTo}`;
      case 'coverage-changed-on-scope':
        return t`Coverage of ${control} went from ${coverageFrom} to ${coverageTo} on ${scope}`;
      default:
        return item.label ?? item.key;
    }
  },
};
