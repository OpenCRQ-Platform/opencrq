import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { FindingSourceReport } from '../finding-stream';
import type { FindingHistoryEntry } from '../../supporting-assets/components/finding-history';
import { HistoryTestedOn } from '../../supporting-assets/components/finding-history';
import { formatDateTime } from '../../../utils';
import { TooltipHintProvider } from '../../../components/shared';
import { getFindingStream } from '../finding-stream';
import { DossierCard } from './dossier-card';
import { HistoryAvatar } from './history-avatar';

interface FindingHistoryCardProps {
  /** Chronological, as stored: the card reverses it so the newest transition reads first. */
  history: Array<FindingHistoryEntry>,
  /** Every connector's own report on this finding, merged into the same chronology as the state transitions. */
  sources: Array<FindingSourceReport>,
  connectorName: string,
}

export const FindingHistoryCard: FunctionComponent<FindingHistoryCardProps> = ({ history, sources, connectorName }) => {
  const stream = getFindingStream(history, sources, connectorName);
  return (
    <DossierCard label={t`History`}>
      {stream.length === 0 ? (
        <span className="font-content-base text-content-base text-default-secondary">
          <Trans>No state change has been recorded yet.</Trans>
        </span>
      ) : (
        <TooltipHintProvider>
          <ul className="flex flex-col">
            {[...stream].reverse().map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-3 border-b py-3 last:border-b-0"
                style={{ borderColor: 'var(--fds-border-elevation-subtle-soft)' }}
              >
                <HistoryAvatar name={entry.actorName ?? t`Unknown source`} icon={entry.icon} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-content-base text-content-base">{entry.text}</span>
                  <HistoryTestedOn testedAt={entry.testedAt ?? null} className="font-content-caption text-content-caption text-default-secondary" />
                </span>
                <span className="shrink-0 font-content-caption text-content-caption text-default-secondary">
                  {formatDateTime(entry.at)}
                </span>
              </li>
            ))}
          </ul>
        </TooltipHintProvider>
      )}
    </DossierCard>
  );
};
