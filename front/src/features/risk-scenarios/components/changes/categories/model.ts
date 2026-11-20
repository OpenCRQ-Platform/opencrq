import { t } from '@lingui/core/macro';
import type { CategoryView } from './category-view';

export const modelView: CategoryView = {
  label: () => t`Model`,
  itemName: (item) => {
    switch (item.key) {
      case 'calibration-vintage':
        return t`Calibration`;
      case 'catalogue-vintage':
        return t`Control catalogue`;
      case 'corner-constants':
        return t`Constants at a corner`;
      case 'iterations':
        return t`Worlds drawn`;
      case 'estate-mode':
        return t`Estate measured`;
      default:
        return item.key;
    }
  },
  textValue: (item, value) => {
    if (item.key !== 'estate-mode') {
      return value;
    }
    return value === 'open' ? t`Whole estate` : t`Mapped assets only`;
  },
};
