import type { ChangeCategoryKey, ChangeEvent } from '@app/module/client';
import type { CategoryView } from './category-view';
import { criticalAssetsView, highAssetsView, otherAssetsView } from './asset-posture';
import { controlsView } from './controls';
import { attackFrequencyView } from './attack-frequency';
import { criticalFindingsView, highFindingsView, otherFindingsView } from './findings';
import { modelView } from './model';
import { runResultsView } from './run-results';
import { techniqueCoverageView } from './technique-coverage';

export type { CategoryView } from './category-view';

export const CATEGORY_VIEWS: Record<ChangeCategoryKey, CategoryView> = {
  controls: controlsView,
  'findings-critical': criticalFindingsView,
  'findings-high': highFindingsView,
  'findings-other': otherFindingsView,
  'assets-critical': criticalAssetsView,
  'assets-high': highAssetsView,
  'assets-other': otherAssetsView,
  'attack-frequency': attackFrequencyView,
  'run-results': runResultsView,
  'technique-coverage': techniqueCoverageView,
  model: modelView,
};

export const changeSentence = (event: ChangeEvent): string => {
  const view = CATEGORY_VIEWS[event.category];
  if (event.sentence.key === 'value-changed' || view.sentence === undefined) {
    return view.itemName(event.item);
  }
  return view.sentence(event);
};
