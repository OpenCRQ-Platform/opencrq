import type { SanityWarning } from '@app/module/client';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { WarningDot } from '../../../components/shared';
import { formatDollar, formatFixed } from '../../../utils';

interface ScenarioPlausibilityNoticeProps {
  warnings: ReadonlyArray<SanityWarning>,
}

/**
 * The plausibility verdict on the saved total, against the risk scope's own scale and the loss
 * history it declared. It states a doubt and stops there: no figure is capped, and none of these
 * warnings blocks a save — an implausible total can be the correct one, and the reader is the one
 * who can tell.
 */
export const ScenarioPlausibilityNotice: FunctionComponent<ScenarioPlausibilityNoticeProps> = ({ warnings }) => {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <div className="rounded-l-sm border-l-2 border-l-orange bg-card px-4 py-3">
      <p className="txt-subtitle2 text-orange">{t`Worth a second look`}</p>
      <ul className="mt-2 flex flex-col gap-1">
        {warnings.map((warning) => {
          const total = formatDollar(warning.expectedTotalUsd);
          const anchor = formatDollar(warning.anchorUsd);
          const multiple = formatFixed(warning.ratio, 1);
          return (
            <li key={warning.kind} className="flex min-w-0 items-start gap-2 txt-sub-content">
              <WarningDot />
              <span>
                {warning.kind === 'over_pricing' ? (
                  <Trans>
                    The expected total of {total} is {multiple} times the largest single loss this risk scope's
                    size and declared history make plausible ({anchor}). Either a driver is priced too high, or this
                    scenario really is that severe.
                  </Trans>
                ) : (
                  <Trans>
                    The expected total of {total} is below the costliest incident this risk scope reports having
                    already suffered ({anchor}). If that incident resembles this scenario, the drivers here are
                    under-priced.
                  </Trans>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
