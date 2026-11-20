import type { ChipSeverity } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { HighlightColor } from '../../../components/shared/ttp-matrix-cell';

/** The categories the curated junction can hold; `inferred` is mixture-derived and never a junction row. */
export type CuratedTechniqueCategory = 'signature' | 'related';
export type TechniqueCategory = CuratedTechniqueCategory | 'inferred';
/** What gets rendered: `revoked` overrides the category for display, it is not a category a technique is curated with. */
export type DisplayCategory = TechniqueCategory | 'revoked';

export const TECHNIQUE_CATEGORY_STYLE: Record<DisplayCategory, { severity: ChipSeverity, highlight: HighlightColor }> = {
  signature: { severity: 'info', highlight: 'blue' },
  related: { severity: 'low', highlight: 'green' },
  inferred: { severity: 'high', highlight: 'orange' },
  revoked: { severity: 'critical', highlight: 'red' },
};

export const techniqueCategoryLabel = (category: DisplayCategory): string => {
  switch (category) {
    case 'signature': return t`Signature`;
    case 'related': return t`Related`;
    case 'inferred': return t`Inferred`;
    case 'revoked': return t`Revoked`;
  }
};

export const resolveDisplayCategory = (technique: { category: TechniqueCategory, revoked: boolean }): DisplayCategory =>
  technique.revoked ? 'revoked' : technique.category;
