import { Chip, Icon } from '@filigran/design-system';
import type { ChipSeverity } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { MetricInfo } from '../../../components/shared';
import { getConnectorIconBySource, getConnectorNameBySource } from '../../integrations';
import { formatDate } from '../../../utils';
import { DossierCard } from './dossier-card';

interface FindingSourceEntry {
  connectorId: string | null,
  source: string | null,
  sourceFindingId: string | null,
  /** Set only when the reporting connector has a page of its own for this finding. */
  sourceFindingUrl?: string | null,
  reportedSeverity: string | null,
  firstSeenAt: Date | string | null,
  lastSeenAt: Date | string | null,
}

interface FindingSourcesCardProps {
  /** One line per reporting source, its own first seen, last seen and reported severity (CAP-4/CAP-5). */
  sources: Array<FindingSourceEntry>,
}

const SEVERITY_CHIP_TONE: Record<string, ChipSeverity> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

/** A connector's own severity vocabulary rarely matches ours exactly; unrecognised values fall back to a bare chip. */
const severityChipTone = (reportedSeverity: string): ChipSeverity | undefined => SEVERITY_CHIP_TONE[reportedSeverity.toLowerCase()];

/** One row per reporting source: a consolidated finding is reviewed once, but each report stays its own reading. */
export const FindingSourcesCard: FunctionComponent<FindingSourcesCardProps> = ({ sources }) => (
  <DossierCard
    label={t`Sources`}
    headerAction={(
      <MetricInfo
        title={t`Sources`}
        what={t`Every connector currently reporting this finding on this asset.`}
        how={t`One row per connector with an observation on this finding.`}
      />
    )}
  >
    <table className="w-full">
      <thead>
        <tr>
          <th scope="col" className="txt-container-title text-muted-foreground text-left font-normal"><Trans>Source</Trans></th>
          <th scope="col" className="txt-container-title text-muted-foreground text-left font-normal"><Trans>First seen</Trans></th>
          <th scope="col" className="txt-container-title text-muted-foreground text-left font-normal"><Trans>Last seen</Trans></th>
          <th scope="col" className="txt-container-title text-muted-foreground text-left font-normal"><Trans>Severity reported</Trans></th>
          <th scope="col" className="txt-container-title text-muted-foreground text-left font-normal"><Trans>Source finding</Trans></th>
        </tr>
      </thead>
      <tbody>
        {sources.map((entry, index) => {
          const name = entry.source === null ? t`Unknown source` : (getConnectorNameBySource(entry.source) ?? entry.source);
          const icon = entry.source === null ? null : getConnectorIconBySource(entry.source);
          return (
            <tr
              key={`${entry.connectorId ?? 'none'}-${index}`}
              style={{ borderTop: '1px solid var(--fds-border-elevation-subtle-soft)' }}
            >
              <td className="py-3">
                <span className="flex items-center gap-2">
                  {icon !== null && <img src={icon} alt="" className="h-5 w-5 shrink-0 rounded-full object-contain" />}
                  <span className="font-medium">{name}</span>
                </span>
              </td>
              <td className="py-3">{entry.firstSeenAt === null ? t`Unknown` : formatDate(entry.firstSeenAt)}</td>
              <td className="py-3">{entry.lastSeenAt === null ? t`Unknown` : formatDate(entry.lastSeenAt)}</td>
              <td className="py-3">
                {entry.reportedSeverity === null
                  ? <span className="text-default-secondary"><Trans>Unknown</Trans></span>
                  : <Chip severity={severityChipTone(entry.reportedSeverity)} label={entry.reportedSeverity} />}
              </td>
              <td className="py-3">
                {entry.sourceFindingId === null
                  ? <span className="text-default-secondary"><Trans>Unknown</Trans></span>
                  : (entry.sourceFindingUrl
                    ? (
                      <a
                        href={entry.sourceFindingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-w-0 items-center gap-1 truncate font-content-code text-content-code text-primary underline-offset-4 hover:underline"
                      >
                        <span className="truncate">{entry.sourceFindingId}</span>
                        <Icon name="external-link" size={16} className="shrink-0" />
                      </a>
                    )
                    : <span className="truncate font-content-code text-content-code">{entry.sourceFindingId}</span>)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </DossierCard>
);
