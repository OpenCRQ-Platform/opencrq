import { Icon } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { AssetCategory, AssetCriticality } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { InfoTooltip, MetricInfo } from '../../../components/shared';
import { getConnectorIconBySource, getConnectorNameBySource } from '../../integrations';
import { useTRPC } from '../../../lib';
import { formatDate, getAssetCategoryLabel, getAssetCriticalityLabel, getAssetExposureLabel } from '../../../utils';
import { sourceExternalUrl } from '../source-external-url';

interface AssetSourceEntry {
  connectorId: string | null,
  /** `user` for the observation a person typed by hand, which reports no machine and links nowhere. */
  origin: 'connector' | 'user',
  source: string | null,
  sourceAssetId: string,
  firstSeenAt: Date | string | null,
  lastSeenAt: Date | string | null,
  reportedName: string | null,
  reportedCategoryId: AssetCategory,
  reportedExposure: 'internet_facing' | 'internal' | 'unknown',
  reportedCriticality: AssetCriticality,
}

interface AssetSourcesCardProps {
  sources: Array<AssetSourceEntry>,
}

/** One reporting connector, per row: the id it knows the asset by, first/last seen, reading, and a link out. */
const AssetSourceRow: FunctionComponent<{ entry: AssetSourceEntry, connectorUrl: string | null, isLast: boolean }> = ({ entry, connectorUrl, isLast }) => {
  const isManual = entry.origin === 'user';
  // A hand-typed observation has no connector to name, and `source` is null for it exactly as it is
  // for an observation whose connector was deleted — hence the origin, not the missing source.
  const name = isManual ? t`Set by hand` : (entry.source === null ? t`Unknown source` : (getConnectorNameBySource(entry.source) ?? entry.source));
  const icon = entry.source === null ? null : getConnectorIconBySource(entry.source);
  const externalUrl = isManual ? null : sourceExternalUrl(entry.source, entry.sourceAssetId, connectorUrl, entry.reportedCategoryId);
  const firstSeen = entry.firstSeenAt === null ? t`Unknown` : formatDate(entry.firstSeenAt);
  const lastSeen = entry.lastSeenAt === null ? t`Unknown` : formatDate(entry.lastSeenAt);
  const reported = [
    entry.reportedName,
    getAssetCategoryLabel(entry.reportedCategoryId),
    getAssetExposureLabel(entry.reportedExposure),
    getAssetCriticalityLabel(entry.reportedCriticality),
  ].filter((v): v is string => v !== null).join(' · ');

  return (
    <div
      className="flex items-center justify-between gap-4 py-3"
      style={{ borderBottom: isLast ? undefined : '1px solid var(--fds-border-elevation-subtle-soft)' }}
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon !== null && <img src={icon} alt="" className="h-5 w-5 shrink-0 rounded-full object-contain" />}
        <span className="truncate font-medium">{name}</span>
        <InfoTooltip label={t`About this source`}>
          {isManual
            ? (
              <span>
                <Trans>The category fields someone filled in on this asset. Resync with connectors removes them.</Trans>
              </span>
            )
            : (
              <>
                <span>
                  <Trans>Source asset id:</Trans>
                  {' '}
                  <span className="font-content-code">{entry.sourceAssetId}</span>
                </span>
                <span>
                  <Trans>First seen: {firstSeen}</Trans>
                </span>
                <span>
                  <Trans>Last seen: {lastSeen}</Trans>
                </span>
                <span>
                  <Trans>Reported: {reported}</Trans>
                </span>
              </>
            )}
        </InfoTooltip>
      </span>
      {externalUrl !== null && (
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-1 text-primary underline-offset-4 hover:underline"
        >
          <Trans>Open in {name}</Trans>
          <Icon name="external-link" size={16} />
        </a>
      )}
    </div>
  );
};

/** One row per reporting source: the id it knows the asset by and its own reading, plus a link to open it in the connector. */
export const AssetSourcesCard: FunctionComponent<AssetSourcesCardProps> = ({ sources }) => {
  const trpc = useTRPC();
  const { data: connectors } = useQuery(trpc.connectors.listConnectors.queryOptions());
  const urlBySource = new Map<string, string | null>((connectors ?? []).map((c) => [c.source, c.url]));

  if (sources.length === 0) {
    return <p className="text-muted-foreground txt-sub-content">{t`This asset was created by hand.`}</p>;
  }

  return (
    <div className="flex flex-col">
      {sources.map((entry, index) => (
        <AssetSourceRow
          key={`${entry.connectorId ?? 'none'}-${index}`}
          entry={entry}
          connectorUrl={entry.source === null ? null : (urlBySource.get(entry.source) ?? null)}
          isLast={index === sources.length - 1}
        />
      ))}
    </div>
  );
};

/** What the Sources card means: never the match provenance, out of scope for v1. */
export const AssetSourcesCardInfo: FunctionComponent = () => (
  <MetricInfo
    title={t`Sources`}
    what={t`Every connector currently reporting this asset, plus the category fields someone filled in by hand.`}
    how={t`One row per connector that has an observation on this asset in the tenant, and one for a hand-typed observation when there is one.`}
  />
);
