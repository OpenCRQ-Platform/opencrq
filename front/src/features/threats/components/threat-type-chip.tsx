import { Chip } from '@filigran/design-system';
import type { ThreatEntityType } from '@app/module/client';
import type { FunctionComponent, ReactElement } from 'react';
import { threatEntityTypeLabel } from './threat-type-badge';
import { ThreatTypeIcon } from './threat-type-icon';

interface ThreatTypeChipProps {
  entityType: ThreatEntityType,
}

export const ThreatTypeChip: FunctionComponent<ThreatTypeChipProps> = ({ entityType }): ReactElement => (
  <span className="whitespace-nowrap">
    <Chip entity="all-threats" startIcon={<ThreatTypeIcon entityType={entityType} />} label={threatEntityTypeLabel(entityType)} />
  </span>
);
