import { Chip } from '@filigran/design-system';
import type { ChipSeverity } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { Provenance } from '../scenario-loss-utils';

interface ProvenanceBadgeProps {
  provenance: Provenance,
}

const SEVERITY_BY_PROVENANCE: Record<Provenance, ChipSeverity> = {
  questionnaire: 'info',
  manual: 'neutral',
};

/**
 * An Auto/Manual label pill — never the FDS `Badge`, which marks a count, not a state. `Auto` is
 * the word the TEF toggle gives the same derived side.
 */
export const ProvenanceBadge: FunctionComponent<ProvenanceBadgeProps> = ({ provenance }) => (
  <Chip
    severity={SEVERITY_BY_PROVENANCE[provenance]}
    label={provenance === 'questionnaire' ? t`Auto` : t`Manual`}
  />
);
