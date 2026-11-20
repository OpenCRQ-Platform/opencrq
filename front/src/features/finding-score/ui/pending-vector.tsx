import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { InfoTooltip } from '../../../components/shared/info-tooltip';

export const PendingVectorInfo: FunctionComponent = () => (
  // A list row opens on click: the tooltip's own click must not reach it.
  <span className="inline-flex" onClick={(event) => event.stopPropagation()}>
    <InfoTooltip label={t`Why pending vector`}>
      {t`No usable CVSS vector for this CVE yet.`}
    </InfoTooltip>
  </span>
);

export const PendingVectorMark: FunctionComponent = () => (
  <span className="inline-flex items-center gap-1 whitespace-nowrap text-default-secondary">
    {t`Pending vector`}
    <PendingVectorInfo />
  </span>
);
