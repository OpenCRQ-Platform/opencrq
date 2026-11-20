import { Plural, Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { formatDate } from '../../../utils';

interface ThreatSignalBannerProps {
  citingCount: number,
  activeCount: number,
  lastObservedAt: Date | string | null,
}

/**
 * What the ingested corpus says about who is after this flaw.
 *
 * KEV and EPSS are deliberately absent: they are published figures about the vulnerability, so they
 * are filed with it in the Overview record, and the reading this tab adds is the actor one.
 */
export const ThreatSignalBanner: FunctionComponent<ThreatSignalBannerProps> = ({
  citingCount,
  activeCount,
  lastObservedAt,
}) => {
  const lastObservedLabel = lastObservedAt === null ? '' : formatDate(lastObservedAt);

  return (
    <div
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[var(--fds-radius-sm)] px-4 py-3"
      style={{
        background: activeCount > 0
          ? 'var(--fds-color-feedback-warning-secondary-transparency-30)'
          : 'var(--fds-color-feedback-neutral-secondary-transparency-30)',
      }}
    >
      {citingCount === 0 ? (
        <span className="font-content-base text-content-base">
          <Trans>No ingested threat cites this CVE.</Trans>
        </span>
      ) : (
        <>
          <span className="font-content-title-xs text-content-title-xs">
            <Plural
              value={citingCount}
              one="# threat cites this CVE"
              other="# threats cite this CVE"
            />
          </span>
          <span className="font-content-compact text-content-compact text-default-secondary">
            <Plural value={activeCount} _0="none active" one="# active" other="# active" />
            {lastObservedAt !== null && (
              <Trans> · last observed {lastObservedLabel}</Trans>
            )}
          </span>
        </>
      )}
    </div>
  );
};
