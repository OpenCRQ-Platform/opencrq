import { t } from '@lingui/core/macro';

export const actorClassLabel = (actorClass: string | null): string => {
  switch (actorClass) {
    case 'opportunistic_crime':
      return t`Opportunistic crime`;
    case 'ransomware_operator':
      return t`Organized cybercrime`;
    case 'state_sponsored':
      return t`State sponsored`;
    case 'hacktivist':
      return t`Hacktivist`;
    case null:
    default:
      return t`Unclassified actor`;
  }
};
