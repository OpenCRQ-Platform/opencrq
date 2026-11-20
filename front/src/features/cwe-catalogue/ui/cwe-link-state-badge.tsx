import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';

interface CweLinkStateBadgeProps {
  value: 'shipped' | 'added' | 'removed',
}

export const CweLinkStateBadge: FunctionComponent<CweLinkStateBadgeProps> = ({ value }) => {
  if (value === 'shipped') {
    return null;
  }
  return value === 'removed'
    ? <Chip severity="critical" label={t`Removed`} />
    : <Chip severity="low" label={t`Added`} />;
};
