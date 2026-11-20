import { Chip, Icon, Paper } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { ExpectationType } from '@app/module/client';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { KPI_TILE_GUTTER, KpiTile, SourceStack, tileTonePaint } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { formatNumber } from '../../../utils/format-number';
import { getEndpointPlatformLabel, getExpectationTypeLabel } from '../../../utils';

interface UniqueTechniqueFindingHeaderPanelProps {
  externalId: string,
  name: string,
  expectationType: ExpectationType,
  affectedAssetCount: number,
  platforms: Array<string>,
  sources: Array<string>,
}

/** The CVE finding header's kind tile size, so the two pages read alike. */
const KIND_TILE_SIZE = 72;

/** Technique findings carry no score, hence no score tile and a neutral tint. */
export const UniqueTechniqueFindingHeaderPanel: FunctionComponent<UniqueTechniqueFindingHeaderPanelProps> = ({
  externalId,
  name,
  expectationType,
  affectedAssetCount,
  platforms,
  sources,
}) => {
  const paint = tileTonePaint('neutral');

  return (
    <Paper elevation={1} className="flex flex-col gap-4 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex shrink-0 items-center justify-center rounded-[var(--fds-radius-sm)]"
          style={{
            height: KIND_TILE_SIZE,
            width: KIND_TILE_SIZE,
            background: paint.fill,
            color: paint.text,
            border: '1px solid var(--fds-border-elevation-subtle-soft)',
          }}
        >
          <Icon name="radar" size={24} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5" style={{ minHeight: KIND_TILE_SIZE }}>
          <span
            className="font-content-caption text-content-caption font-semibold uppercase tracking-[var(--fds-tracking-relaxed)]"
            style={{ color: paint.text }}
          >
            <Trans>Unique technique finding</Trans>
          </span>
          <h1 className="flex min-w-0 flex-wrap items-center gap-2.5 text-[var(--fds-text-6)] font-medium">
            <span className="truncate">
              <span className="font-content-code">{externalId}</span>
              {' '}
              {name}
            </span>
            <Chip label={getExpectationTypeLabel(expectationType)} />
          </h1>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-y-3" style={{ columnGap: KPI_TILE_GUTTER }}>
        <KpiTile
          icon="layers"
          tone="info"
          caption={plural(affectedAssetCount, { one: 'Affected asset', other: 'Affected assets' })}
          value={(
            <Link
              from="/$tenantId/{-$organizationId}/findings/technique/$externalId/$expectationType"
              to="assets"
              className="text-primary underline-offset-4 hover:underline"
            >
              {formatNumber(affectedAssetCount)}
            </Link>
          )}
        />
        <KpiTile
          icon="monitor"
          caption={plural(platforms.length, { one: 'Platform', other: 'Platforms' })}
          value={platforms.length === 0
            ? <EmptyValue />
            : (
              <span className="flex flex-wrap gap-1.5 font-content-base">
                {platforms.map((platform) => <Chip key={platform} label={getEndpointPlatformLabel(platform)} />)}
              </span>
            )}
        />
        <KpiTile
          icon="shield"
          caption={t`MITRE ATT&CK`}
          value={(
            <Link
              to="/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId"
              params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', techniqueExternalId: externalId })}
              className="truncate font-content-base text-content-base text-primary underline-offset-4 hover:underline"
            >
              <Trans>Technique page</Trans>
            </Link>
          )}
        />
        <KpiTile
          isLast
          mark={<SourceStack sources={sources} />}
          caption={plural(sources.length, { one: '# source', other: '# sources' })}
        />
      </div>
    </Paper>
  );
};
