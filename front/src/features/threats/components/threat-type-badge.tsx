import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { ThreatEntityType } from '@app/module/client';
import type { FunctionComponent, ReactElement } from 'react';

/** The product's one wording for each STIX type a threat is read from. */
export const threatEntityTypeLabel = (entityType: ThreatEntityType): string => {
  switch (entityType) {
    case 'intrusion-set':
      return t`Intrusion set`;
    case 'threat-actor':
      return t`Threat actor`;
    case 'campaign':
      return t`Campaign`;
  }
};

interface ThreatTypeBadgeProps {
  entityType: ThreatEntityType,
}

export const ThreatTypeBadge: FunctionComponent<ThreatTypeBadgeProps> = ({ entityType }): ReactElement => (
  <Chip label={threatEntityTypeLabel(entityType)} />
);
