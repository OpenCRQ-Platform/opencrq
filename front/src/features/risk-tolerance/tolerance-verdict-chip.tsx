import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';

export const ToleranceVerdictChip: FunctionComponent<{ outside: boolean }> = ({ outside }) => (
  <Chip label={outside ? t`Outside tolerance` : t`Within tolerance`} severity={outside ? 'critical' : 'low'} />
);
