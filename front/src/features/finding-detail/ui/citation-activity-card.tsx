import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { CitationEvent } from '../citation-activity-utils';
import { TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { formatDate } from '../../../utils';
import { buildCitationActivity } from '../citation-activity-utils';
import { DossierCard } from './dossier-card';

/** Below this share of the peak a bar would read as an empty month, so a counted month never goes under it. */
const MIN_COUNTED_BAR_PERCENT = 8;

export const CitationActivityCard: FunctionComponent<{ events: Array<CitationEvent> }> = ({ events }) => {
  const { cells, peak, total, latestAt } = buildCitationActivity(events, new Date());
  const monthFormat = new Intl.DateTimeFormat(i18n.locale || 'en', { month: 'short', year: '2-digit' });
  const drawn = cells.reduce((sum, cell) => sum + cell.count, 0);
  const firstMonth = monthFormat.format(cells[0].month);
  const lastMonth = monthFormat.format(cells[cells.length - 1].month);
  const latestLabel = latestAt === null ? '' : formatDate(latestAt);
  // The bars carry their count in a hover-only tooltip, so the accessible name has to hold the
  // whole series: without it the chart states a window and none of what it draws inside it.
  const series = cells.map((cell) => `${monthFormat.format(cell.month)} ${cell.count}`).join(', ');

  return (
    <DossierCard label={t`Citation activity · last 12 months`}>
      <TooltipHintProvider>
        <div
          className="flex h-24 items-end gap-1"
          role="img"
          aria-label={t`Citations dated per month, ${firstMonth} to ${lastMonth}: ${series}`}
        >
          {cells.map((cell) => (
            <TooltipHint
              key={cell.month.toISOString()}
              hint={`${monthFormat.format(cell.month)} · ${cell.count === 0
                ? t`no citation`
                : plural(cell.count, { one: '# citation', other: '# citations' })}`}
            >
              <i
                className="flex-1 rounded-t-[2px]"
                style={{
                  height: cell.count === 0
                    ? '2px'
                    : `${Math.max(MIN_COUNTED_BAR_PERCENT, (cell.count / peak) * 100)}%`,
                  background: cell.count === peak && peak > 0
                    ? 'var(--fds-color-entities-all-threats)'
                    : 'var(--fds-color-entities-all-threats-transparency-20)',
                }}
              />
            </TooltipHint>
          ))}
        </div>
      </TooltipHintProvider>
      <div className="flex justify-between font-content-caption text-content-caption text-default-secondary">
        <span>{firstMonth}</span>
        <span>{lastMonth}</span>
      </div>
      {drawn === 0 && total > 0 && latestAt !== null && (
        <p className="font-content-base text-content-base">
          <Trans>Nothing was dated on this CVE over the drawn window. The most recent citation dates from {latestLabel}.</Trans>
        </p>
      )}
      <p className="font-content-caption text-content-caption text-default-secondary">
        <Trans>Dated relationships between a threat and this CVE, across ingested analyses. Peaks mark reporting waves, not exploitation volume.</Trans>
      </p>
    </DossierCard>
  );
};
