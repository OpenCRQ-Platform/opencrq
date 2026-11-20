import type { IconName } from '@filigran/design-system';
import { Icon, Paper } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import type { AssetCategory, AssetCriticality, AssetSubcategory, PostureBand } from '@app/module/client';
import { postureSeverityBand } from '@app/module/client';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent, ReactNode } from 'react';
import type { CrqPosture } from './crq-posture-tile';
import type { PostureCounts } from '../../../components/shared';
import type { AssetNameParts } from '../../../utils/asset-name-utils';
import { KpiTile, resolvePostureScore, SourceStack, tileTonePaint, tileToneWash } from '../../../components/shared';
import { AssetName } from '../../../components/shared/asset-name';
import { EmptyValue } from '../../../components/ui/empty-value';
import { getAssetCategoryLabel } from '../../../utils';
import { ScoreGaugeMark } from '../../finding-score';
import { identityGlanceOf } from '../identity-glance-utils';
import { AssetCriticalityChip, AssetExposureChip } from './asset-chips';
import { CrqPostureTile } from './crq-posture-tile';
import { postureBandWord } from './posture-band-word';

interface AssetHeaderPanelProps {
  tenantId: string,
  supportingAssetId: string,
  assetName: AssetNameParts,
  categoryId: AssetCategory,
  subcategoryId: AssetSubcategory | null,
  criticality: AssetCriticality,
  exposure: 'internet_facing' | 'internal' | 'unknown',
  applicableEvidenceCount: number,
  ttpCount: number,
  /** Every connector reporting this asset; empty when a person created it by hand. */
  sources: Array<string>,
  /** OpenAEV's raw SUCCESS/FAILED counts, read live; `null` while loading or when OpenAEV has none to give — no tile then. */
  postureCounts: PostureCounts | null,
  crqPosture: CrqPosture | null | undefined,
  actions: ReactNode,
}

/**
 * The square tile is as tall as the whole identity block, and a flex item cannot take its width
 * from a stretched height, so the tile states the size and the text block matches it.
 */
const KIND_TILE_SIZE = 72;

/**
 * An identity takes the list's own person-or-robot distinction, so the header and the row agree.
 * One whose subcategory no source stated still shows a person: the tile has to show something, and
 * the robot is kept for what a source said runs unattended.
 */
const kindIconOf = (categoryId: AssetCategory, subcategoryId: AssetSubcategory | null): IconName => {
  if (categoryId !== 'identity') {
    return 'monitor';
  }
  return identityGlanceOf(categoryId, subcategoryId) === 'non-human' ? 'bot' : 'user';
};

const CRITICALITY_TONE: Record<AssetCriticality, 'critical' | 'high' | 'medium' | 'low' | 'neutral'> = {
  very_high: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  unknown: 'neutral',
};

const EXPOSURE_TONE: Record<'internet_facing' | 'internal' | 'unknown', 'critical' | 'info' | 'neutral'> = {
  internet_facing: 'critical',
  internal: 'info',
  unknown: 'neutral',
};

/**
 * Same anatomy as the finding banner (`FindingHeaderPanel`): identity block, then a row of KPI
 * tiles. The tile takes the `info` tone rather than the asset's own criticality — the asset itself
 * carries no severity level to tint the banner with, only a `Criticality` reading among the tiles.
 */
/** The shared score gauge, speaking the posture's own metric and vocabulary rather than a finding's. */
const PostureGaugeMark: FunctionComponent<{ score: number, band: PostureBand }> = ({ score, band }) => {
  const word = postureBandWord(band);
  return (
    <ScoreGaugeMark
      score={score}
      band={postureSeverityBand(band)}
      label={i18n._({ id: 'OpenAEV Posture score: {score} out of 100, {word}', message: 'OpenAEV Posture score: {score} out of 100, {word}', values: { score, word } })}
    />
  );
};

export const AssetHeaderPanel: FunctionComponent<AssetHeaderPanelProps> = ({
  tenantId,
  supportingAssetId,
  assetName,
  categoryId,
  subcategoryId,
  criticality,
  exposure,
  applicableEvidenceCount,
  ttpCount,
  sources,
  postureCounts,
  crqPosture,
  actions,
}) => {
  const infoPaint = tileTonePaint('info');
  const categoryLabel = getAssetCategoryLabel(categoryId);
  const postureScore = resolvePostureScore(postureCounts);

  return (
    <Paper elevation={1} className="flex flex-col gap-4 p-4" style={{ backgroundImage: tileToneWash('info'), backgroundOrigin: 'border-box' }}>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex shrink-0 items-center justify-center rounded-[var(--fds-radius-sm)]"
            style={{
              height: KIND_TILE_SIZE,
              width: KIND_TILE_SIZE,
              background: infoPaint.fill,
              color: infoPaint.text,
              border: '1px solid var(--fds-border-elevation-subtle-soft)',
            }}
          >
            <Icon name={kindIconOf(categoryId, subcategoryId)} size={24} />
          </span>
          <span
            className="flex min-w-0 flex-1 flex-col justify-center gap-0.5"
            style={{ minHeight: KIND_TILE_SIZE }}
          >
            <span
              className="font-content-caption text-content-caption font-semibold uppercase tracking-[var(--fds-tracking-relaxed)]"
              style={{ color: infoPaint.text }}
            >
              {t`${categoryLabel} asset`}
            </span>
            <h1 className="truncate text-[var(--fds-text-6)] font-medium"><AssetName name={assetName.name} derivedName={assetName.derivedName} /></h1>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start">{actions}</div>
      </div>

      <div className="flex flex-wrap items-center gap-y-3" style={{ columnGap: 24 }}>
        {postureScore.state === 'no-data' && (
          <KpiTile
            mark={(
              <span
                className="flex h-8 w-8 items-center justify-center font-content-base text-content-base text-default-secondary"
                title={t`OpenAEV Posture: nothing validated yet`}
              >
                <EmptyValue />
              </span>
            )}
            caption={t`OpenAEV Posture`}
            captionClassName="max-w-[7ch]"
          />
        )}
        {postureScore.state === 'scored' && (
          <KpiTile
            mark={<PostureGaugeMark score={postureScore.score} band={postureScore.band} />}
            caption={t`OpenAEV Posture`}
            captionClassName="max-w-[7ch]"
          />
        )}
        <CrqPostureTile tenantId={tenantId} posture={crqPosture} />
        <KpiTile icon="shield" tone={CRITICALITY_TONE[criticality]} caption={t`Criticality`} value={<AssetCriticalityChip criticality={criticality} />} />
        <KpiTile icon="custom/globe-line" tone={EXPOSURE_TONE[exposure]} caption={t`Exposure`} value={<AssetExposureChip exposure={exposure} categoryId={categoryId} />} />
        <KpiTile
          icon="bug"
          tone={applicableEvidenceCount > 0 ? 'critical' : 'neutral'}
          caption={t`Findings`}
          value={
            <Link
              to="/$tenantId/{-$organizationId}/assets/$supportingAssetId/findings"
              params={{ tenantId, supportingAssetId }}
              className="truncate font-content-base text-content-base text-primary underline-offset-4 hover:underline"
            >
              {applicableEvidenceCount}
            </Link>
          }
        />
        <KpiTile
          icon="custom/target"
          caption={t`Category TTPs`}
          value={
            <Link
              to="/$tenantId/{-$organizationId}/assets/$supportingAssetId/ttp"
              params={{ tenantId, supportingAssetId }}
              className="truncate font-content-base text-content-base text-primary underline-offset-4 hover:underline"
            >
              {ttpCount}
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
