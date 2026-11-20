import { t } from '@lingui/core/macro';
import type { AttackGroup, MappingConfidence } from '@app/module/client';

export type { AttackGroup, MappingConfidence };

export const confidenceLabel = (confidence: MappingConfidence): string => {
  switch (confidence) {
    case 'high': return t`High confidence`;
    case 'medium': return t`Medium confidence`;
    case 'low': return t`Low confidence`;
  }
};

export const attackGroupLabel = (group: AttackGroup): string => {
  switch (group) {
    case 'exploitation': return t`Exploitation`;
    case 'primary_impact': return t`Primary impact`;
    case 'secondary_impact': return t`Secondary impact`;
    case 'weakness': return t`Made possible by the weakness`;
  }
};
