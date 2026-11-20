import { t } from '@lingui/core/macro';
import type { CategoryView } from './category-view';
import { groupSentence, groupSentenceIn } from './group-sentence';

const cveName = (item: Parameters<CategoryView['itemName']>[0]): string => item.label ?? item.key;

export const criticalFindingsView: CategoryView = {
  label: () => t`Critical findings`,
  itemName: cveName,
  groupSentence: groupSentenceIn('critical'),
};

export const highFindingsView: CategoryView = {
  label: () => t`High findings`,
  itemName: cveName,
  groupSentence: groupSentenceIn('high'),
};

export const otherFindingsView: CategoryView = {
  label: () => t`Other findings`,
  itemName: cveName,
  groupSentence,
};
