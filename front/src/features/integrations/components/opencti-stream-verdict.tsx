import { Chip } from '@filigran/design-system';
import type { ChipSeverity } from '@filigran/design-system';
import { Trans } from '@lingui/react/macro';
import { CircleCheck, CircleHelp, CircleX, TriangleAlert } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import type { StreamRelationship, StreamVerdict } from '../opencti-stream-filter-utils';
import { STREAM_VERDICT_SEVERITY, streamVerdictExplanation, streamVerdictLabel } from '../connector-vocabulary';

const VERDICT_ICON: Record<StreamVerdict, typeof CircleCheck> = {
  delivers: CircleCheck,
  incompatible: CircleX,
  no_actors: CircleX,
  stopped: CircleX,
  undecidable: CircleHelp,
};

/** The feedback family each chip severity paints in, so a notice matches the chip beside it. */
const SEVERITY_TOKEN: Record<ChipSeverity, string> = {
  neutral: 'neutral',
  info: 'info',
  low: 'success',
  medium: 'alert',
  high: 'warning',
  critical: 'error',
  ee: 'info',
};

const Notice: FunctionComponent<{ severity: ChipSeverity, icon: ReactNode, children: ReactNode }> = ({ severity, icon, children }) => (
  <div
    className="flex items-start gap-2.5 rounded-[var(--fds-radius-sm)] px-5 py-3"
    style={{ background: `var(--fds-color-feedback-${SEVERITY_TOKEN[severity]}-secondary-transparency-30)` }}
  >
    {icon}
    <span className="font-content-base text-content-base">{children}</span>
  </div>
);

export const OpenctiStreamVerdictChip: FunctionComponent<{ verdict: StreamVerdict }> = ({ verdict }) => (
  <Chip severity={STREAM_VERDICT_SEVERITY[verdict]} label={streamVerdictLabel(verdict)} />
);

export const OpenctiStreamVerdictNotice: FunctionComponent<{
  verdict: StreamVerdict,
  missingRelationships: Array<StreamRelationship>,
}> = ({ verdict, missingRelationships }) => {
  const severity = STREAM_VERDICT_SEVERITY[verdict];
  const Icon = VERDICT_ICON[verdict];
  return (
    <Notice
      severity={severity}
      icon={(
        <Icon
          className="mt-0.5 size-[18px] shrink-0"
          style={{ color: `var(--fds-color-feedback-${SEVERITY_TOKEN[severity]}-primary)` }}
        />
      )}
    >
      {streamVerdictExplanation(verdict, missingRelationships)}
    </Notice>
  );
};

/**
 * Stated apart from the verdict, never merged into it: a stream can carry what the connector reads
 * and still refuse to replay any of it.
 */
export const OpenctiStreamHistoryNotice: FunctionComponent = () => (
  <Notice
    severity="high"
    icon={<TriangleAlert className="mt-0.5 size-[18px] shrink-0" style={{ color: 'var(--fds-color-feedback-warning-primary)' }} />}
  >
    <Trans>
      This stream does not replay what came before. Only what OpenCTI publishes from the moment the
      connector connects will arrive, and the threat actors already in it will not.
    </Trans>
  </Notice>
);
