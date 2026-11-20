import { Chip } from '@filigran/design-system';
import type { FunctionComponent } from 'react';
import type { DisplayCategory } from './technique-category';
import { TECHNIQUE_CATEGORY_STYLE, techniqueCategoryLabel } from './technique-category';

interface TechniqueCategoryChipProps {
  category: DisplayCategory,
}

export const TechniqueCategoryChip: FunctionComponent<TechniqueCategoryChipProps> = ({ category }) => (
  <Chip severity={TECHNIQUE_CATEGORY_STYLE[category].severity} label={techniqueCategoryLabel(category)} />
);
