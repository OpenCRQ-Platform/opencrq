import { Spinner } from '@filigran/design-system';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';

interface ScenarioRecomputeNoticeProps {
  isRecomputing: boolean,
}

/**
 * Says the amounts below are about to be rewritten. Without it a reader cannot tell a stale figure
 * from a final one, and the questionnaire save that booked the run happened on another page. A
 * status region, since it appears on a refetch rather than on anything the reader just did here.
 */
export const ScenarioRecomputeNotice: FunctionComponent<ScenarioRecomputeNoticeProps> = ({ isRecomputing }) => {
  if (!isRecomputing) {
    return null;
  }

  return (
    <div role="status" className="flex items-center gap-2 rounded-l-sm border-l-2 border-l-highlight bg-card px-4 py-3">
      <Spinner size="sm" />
      <p className="txt-sub-content">
        <Trans>Recomputing from the financial questionnaire. The amounts below are the previous ones until it finishes.</Trans>
      </p>
    </div>
  );
};
