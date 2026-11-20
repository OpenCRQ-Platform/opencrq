import { t } from '@lingui/core/macro';
import type { CategoryView } from './category-view';
import { groupSentence, groupSentenceIn } from './group-sentence';

const assetName = (item: Parameters<CategoryView['itemName']>[0]): string => item.label ?? t`Unnamed asset`;

export const criticalAssetsView: CategoryView = {
  label: () => t`Critical assets`,
  itemName: assetName,
  groupSentence: groupSentenceIn('critical'),
};

export const highAssetsView: CategoryView = {
  label: () => t`High assets`,
  itemName: assetName,
  groupSentence: groupSentenceIn('high'),
};

export const otherAssetsView: CategoryView = {
  label: () => t`Other assets`,
  itemName: assetName,
  groupSentence,
};
