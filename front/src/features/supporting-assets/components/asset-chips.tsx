import { Chip } from '@filigran/design-system';
import type { ChipSeverity } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { AssetCategory, AssetCriticality } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { MetricInfo } from '../../../components/shared';
import { getAssetCriticalityLabel, tagColorHex } from '../../../utils';
import { exposureIsNotApplicable } from '../exposure-utils';

/** `low` takes the design system's own `low` tone: left on the neutral default it and `unknown` read as the same grey. */
const ASSET_CRITICALITY_SEVERITY: Record<AssetCriticality, ChipSeverity> = {
  very_high: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  unknown: 'neutral',
};

/** The one place an asset's criticality is rendered as a chip: the header banner and the Information card share it. */
export const AssetCriticalityChip: FunctionComponent<{ criticality: AssetCriticality }> = ({ criticality }) => (
  <Chip severity={ASSET_CRITICALITY_SEVERITY[criticality]} label={getAssetCriticalityLabel(criticality)} />
);

/** The one place an asset's exposure is rendered as a chip: the header banner and the Information card share it. */
export const AssetExposureChip: FunctionComponent<{ exposure: 'internet_facing' | 'internal' | 'unknown', categoryId: AssetCategory }> = ({ exposure, categoryId }) => {
  if (exposureIsNotApplicable(categoryId, exposure)) {
    return <span className="text-muted-foreground">{t`Not applicable`}</span>;
  }
  if (exposure === 'internet_facing') {
    return <Chip severity="critical" label={t`Internet Facing`} />;
  }
  if (exposure === 'internal') {
    return <Chip severity="info" label={t`Internal`} />;
  }
  return <Chip label={t`Unknown`} />;
};

/**
 * The one place a tag is rendered as a chip. It paints the colour the tag's origin reports, so the
 * same tag does not read blue in OpenAEV and green here; a tag no origin gives a colour falls back
 * to a stable hash of its name. The label is what identifies a tag: two chips can land on
 * neighbouring hues, so the colour only ever aids recall.
 *
 * `Chip`'s `color` axis (an arbitrary per-datum hex, composited into its own bounded, contrast-
 * verified wash) is the axis its contract reserves for exactly this — an open, per-item categorical
 * set — unlike `severity` (a closed set of feedback tones) or `entity` (nine tokens carrying their
 * own product meaning, e.g. `techniques`, `cases`, which an arbitrary tag name would misuse).
 */
export const AssetTagChip: FunctionComponent<{ name: string, color: string | null }> = ({ name, color }) => (
  <Chip label={name} color={color ?? tagColorHex(name)} />
);

/** What the Information card's Tags field means: every connector's or person's own assertion, deduped by tag. */
export const AssetTagsFieldInfo: FunctionComponent = () => (
  <MetricInfo
    title={t`Tags`}
    what={t`Every tag asserted on this asset, by any connector or by hand.`}
    how={t`One chip per tag name — several authors of the same tag still show as one.`}
  />
);
