import { t } from '@lingui/core/macro';
import type { CategoryView } from './category-view';
import { getAssetCategoryLabel } from '../../../../../utils/asset-category-utils';

export const techniqueCoverageView: CategoryView = {
  label: () => t`Technique coverage`,
  itemName: (item) => item.label ?? item.key,
  sentence: ({ sentence, item }) => {
    const technique = String(sentence.parts.technique);
    const family = getAssetCategoryLabel(String(sentence.parts.family));
    switch (sentence.key) {
      case 'uncontested-by-estate':
        return t`${technique} on ${family} assets is no longer contested by any control of the estate`;
      case 'uncontestable-by-catalogue':
        return t`${technique} on ${family} assets cannot be contested by any capability of the catalogue`;
      case 'contested-by-estate':
        return t`${technique} on ${family} assets is now contested by a control of the estate`;
      case 'contestable-by-catalogue':
        return t`${technique} on ${family} assets can now be contested by a capability of the catalogue`;
      default:
        return item.label ?? item.key;
    }
  },
};
