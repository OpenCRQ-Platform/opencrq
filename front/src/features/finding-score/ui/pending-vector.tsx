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

export const NoNvdRecordInfo: FunctionComponent = () => (
  // A list row opens on click: the tooltip's own click must not reach it.
  <span className="inline-flex" onClick={(event) => event.stopPropagation()}>
    <InfoTooltip label={t`Why no usable NVD record`}>
      {t`NVD has no record of this CVE, or rejected it, so NVD will not score it. Check that the CVE id is correct.`}
    </InfoTooltip>
  </span>
);

export const NoNvdRecordMark: FunctionComponent = () => (
  <span className="inline-flex items-center gap-1 whitespace-nowrap text-default-secondary">
    {t`No usable NVD record`}
    <NoNvdRecordInfo />
  </span>
);

/** A list cell's mark for a CVE finding with no score: kept short to fit the cell, its tooltip says why. */
export const UnscoredMark: FunctionComponent<{ nvdRecordMissing: boolean }> = ({ nvdRecordMissing }) => (
  nvdRecordMissing
    ? (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-default-secondary">
        {t`No vector`}
        <NoNvdRecordInfo />
      </span>
    )
    : <PendingVectorMark />
);
