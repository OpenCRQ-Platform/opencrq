import { Icon, Paper } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { AssetCategory, DismissalType, EvidenceHistoryOrigin, SeverityBand } from '@app/module/client';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent, ReactNode } from 'react';
import type { AssetNameParts } from '../../../utils/asset-name-utils';
import {
  KPI_TILE_GUTTER,
  KpiTile,
  SourceStack,
  tileTonePaint,
  tileToneWash,
  TooltipHint,
  TooltipHintProvider,
} from '../../../components/shared';
import { AssetName } from '../../../components/shared/asset-name';
import { NoNvdRecordInfo, PendingVectorInfo, ScoreGaugeMark, severityBandLabel } from '../../finding-score';
import { getAssetCategoryLabel } from '../../../utils';
import { assetNameDisplay } from '../../../utils/asset-name-utils';
import { EvidenceStateChip } from './finding-chips';

interface FindingHeaderPanelProps {
  tenantId: string,
  cveId: string,
  cveTitle: string | null,
  /** Null until the recompute has scored the finding, together with the band. */
  score: number | null,
  /** Sits after the score tile's caption, for the arithmetic behind the figure. */
  scoreInfo?: ReactNode,
  band: SeverityBand | null,
  pendingVector: boolean,
  /** An NVD pass read the CVE and found no record: the vector the score waits on will not come from NVD. */
  nvdRecordMissing: boolean,
  supportingAssetId: string,
  assetName: AssetNameParts,
  assetCategoryId: AssetCategory,
  state: 'applicable' | 'dismissed',
  /** What wrote the latest history row, null on a finding that has none. */
  stateOrigin: EvidenceHistoryOrigin | null,
  /** The type a person set the finding aside under; null while it is applicable. */
  dismissalType: DismissalType | null,
  /** How long the finding has been in its current state, already worded by the score vocabulary. */
  stateDuration: string | null,
  otherImpactedAssetCount: number,
  /** Every connector reporting the finding (CAP-4); empty when a person attached it by hand. */
  sources: Array<string>,
  actions: ReactNode,
}

/**
 * The kind tile is a square as tall as the whole identity block, and a flex item cannot take its
 * width from a stretched height, so the tile states the size and the text block matches it.
 */
const KIND_TILE_SIZE = 72;

/**
 * Triage in one glance: what the finding is, what it scores, and the four readings around it.
 *
 * CVSS, EPSS and the KEV listing are not here. They describe the flaw rather than this instance of
 * it, and the Overview tab's Vulnerability card states all three with the feed and date behind each.
 */
export const FindingHeaderPanel: FunctionComponent<FindingHeaderPanelProps> = ({
  tenantId,
  cveId,
  cveTitle,
  score,
  scoreInfo,
  band,
  pendingVector,
  nvdRecordMissing,
  supportingAssetId,
  assetName,
  assetCategoryId,
  state,
  stateOrigin,
  dismissalType,
  stateDuration,
  otherImpactedAssetCount,
  sources,
  actions,
}) => {
  const tone = band ?? 'neutral';
  const bandPaint = tileTonePaint(tone);
  const categoryLabel = getAssetCategoryLabel(assetCategoryId);
  const bandWord = band === null ? '' : severityBandLabel(band);

  return (
    <Paper elevation={1} className="flex flex-col gap-4 p-4" style={{ backgroundImage: tileToneWash(tone), backgroundOrigin: 'border-box' }}>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex shrink-0 items-center justify-center rounded-[var(--fds-radius-sm)]"
            style={{
              height: KIND_TILE_SIZE,
              width: KIND_TILE_SIZE,
              background: bandPaint.fill,
              color: bandPaint.text,
              border: '1px solid var(--fds-border-elevation-subtle-soft)',
            }}
          >
            <Icon name="bug" size={24} />
          </span>
          <span
            className="flex min-w-0 flex-1 flex-col justify-center gap-0.5"
            style={{ minHeight: KIND_TILE_SIZE }}
          >
            <span
              className="font-content-caption text-content-caption font-semibold uppercase tracking-[var(--fds-tracking-relaxed)]"
              style={{ color: bandPaint.text }}
            >
              <Trans>CVE finding</Trans>
            </span>
            <h1 className="truncate text-[var(--fds-text-6)] font-medium">
              {assetNameDisplay(assetName).kind === 'unnamed' ? (
                <span className="font-content-code">{cveId}</span>
              ) : (
                // One message rather than two ids around a translated preposition: the pair reads in
                // its own order in a language that does not put the flaw first.
                <Trans>
                  <span className="font-content-code">{cveId}</span>
                  {' '}
                  <span className="font-content-base text-default-secondary">on</span>
                  {' '}
                  <AssetName name={assetName.name} derivedName={assetName.derivedName} className="font-content-code" />
                </Trans>
              )}
            </h1>
            {cveTitle !== null && (
              <TooltipHintProvider>
                <TooltipHint hint={cveTitle}>
                  <span className="truncate font-content-base text-content-base text-default-secondary">
                    {cveTitle}
                  </span>
                </TooltipHint>
              </TooltipHintProvider>
            )}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start">{actions}</div>
      </div>

      <div className="flex flex-wrap items-center gap-y-3" style={{ columnGap: KPI_TILE_GUTTER }}>
        {pendingVector && (nvdRecordMissing
          ? <KpiTile icon="circle-alert" tone="neutral" caption={t`No usable NVD record`} captionAdornment={<NoNvdRecordInfo />} />
          : <KpiTile icon="clock" tone="neutral" caption={t`Pending vector`} captionAdornment={<PendingVectorInfo />} />)}
        {!pendingVector && (score === null || band === null) && (
          <KpiTile icon="clock" tone="neutral" caption={t`Not scored yet`} />
        )}
        {score !== null && band !== null && (
          <KpiTile
            mark={(
              <ScoreGaugeMark
                score={score}
                band={band}
                label={t`Finding score: ${score} out of 100, ${bandWord} band`}
              />
            )}
            caption={t`Finding score`}
            captionAdornment={scoreInfo}
          />
        )}
        <KpiTile
          icon="activity"
          tone={state === 'applicable' ? 'critical' : 'neutral'}
          caption={stateDuration ?? t`State`}
          value={<EvidenceStateChip state={state} kind="cve" origin={stateOrigin} dismissalType={dismissalType} />}
        />
        <KpiTile
          icon="monitor"
          tone="info"
          caption={t`${categoryLabel} asset`}
          value={
            <Link
              to="/$tenantId/{-$organizationId}/assets/$supportingAssetId/overview"
              params={{ tenantId, supportingAssetId }}
              className="truncate font-content-base text-content-base text-primary underline-offset-4 hover:underline"
            >
              <AssetName name={assetName.name} derivedName={assetName.derivedName} />
            </Link>
          }
        />
        <KpiTile
          icon="layers"
          caption={plural(otherImpactedAssetCount, {
            one: '# other impacted asset',
            other: '# other impacted assets',
          })}
          value={
            <Link
              to="/$tenantId/{-$organizationId}/findings/cve/$cveId"
              params={{ tenantId, cveId }}
              className="truncate font-content-base text-content-base text-primary underline-offset-4 hover:underline"
            >
              {cveId}
            </Link>
          }
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
