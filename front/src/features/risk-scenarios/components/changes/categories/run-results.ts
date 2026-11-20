import { t } from '@lingui/core/macro';
import type { CategoryView } from './category-view';
import { actorClassLabel } from '../../../../threats/actor-class-label';

const runFigureName = (key: string): string => {
  switch (key) {
    case 'tef':
      return t`Threat event frequency (TEF)`;
    case 'susceptibility':
      return t`Effective susceptibility`;
    case 'magnitude':
      return t`Loss magnitude (LM)`;
    case 'lef':
      return t`Loss event frequency (LEF)`;
    case 'outcome-blocked':
      return t`Attacks blocked`;
    case 'outcome-evicted':
      return t`Attacks evicted`;
    case 'outcome-impact-detected':
      return t`Impacts detected`;
    case 'outcome-impact-undetected':
      return t`Impacts undetected`;
    case 'technique-count':
      return t`Techniques scored`;
    case 'covered-technique-count':
      return t`Techniques covered`;
    case 'estate-asset-count':
      return t`Assets walked`;
    case 'unscanned-asset-count':
      return t`Assets without vulnerability data`;
    default:
      return key;
  }
};

export const runResultsView: CategoryView = {
  label: () => t`Run results`,
  itemName: (item) => {
    if (item.kind === 'actor-class-share') {
      const actorClass = actorClassLabel(item.key);
      return t`Share of ${actorClass}`;
    }
    return runFigureName(item.key);
  },
};
