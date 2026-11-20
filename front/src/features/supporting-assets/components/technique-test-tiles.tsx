import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { ExpectationType } from '@app/module/client';
import type { FunctionComponent } from 'react';
import type { TestTally } from './technique-tests-utils';
import { MetricInfo } from '../../../components/shared';
import { EmptyScoreGaugeMark, ScoreGaugeMark } from '../../finding-score';
import { postureBandLabel } from './posture-band-word';
import { assetTestScoreLabel, noAssetResultLabel, testedTechniquesText, testTypeLabel } from './technique-test-labels';
import { heldPostureBand, heldSeverityBand, heldShare } from './technique-tests-utils';

const TileInfo: FunctionComponent<{ type: ExpectationType, tally: TestTally | null }> = ({ type, tally }) => {
  const held = tally?.held ?? 0;
  const total = tally?.total ?? 0;
  if (type === 'prevention') {
    return (
      <MetricInfo
        title={t`Prevention`}
        what={<Trans>The share of this asset's OpenAEV prevention results that were prevented, out of 100.</Trans>}
        how={<Trans>{held} of {total} prevention results were prevented here, each read at its latest OpenAEV verdict.</Trans>}
        caveat={<Trans>A dash means no prevention result on this asset, never a failed one.</Trans>}
      />
    );
  }
  return (
    <MetricInfo
      title={t`Detection`}
      what={<Trans>The share of this asset's OpenAEV detection results that were detected, out of 100.</Trans>}
      how={<Trans>{held} of {total} detection results were detected here, each read at its latest OpenAEV verdict.</Trans>}
      caveat={<Trans>A dash means no detection result on this asset, never a failed one.</Trans>}
    />
  );
};

const TestTile: FunctionComponent<{
  type: ExpectationType,
  tally: TestTally | null,
  tested: number,
  shown: number,
}> = ({ type, tally, tested, shown }) => {
  const label = testTypeLabel(type);
  return (
    <div className="flex w-[300px] items-center gap-3.5 rounded-sm border border-[var(--fds-border-elevation-subtle)] px-4 py-3">
      {tally === null
        ? <EmptyScoreGaugeMark label={noAssetResultLabel(type)} />
        : <ScoreGaugeMark score={heldShare(tally)} band={heldSeverityBand(tally)} label={assetTestScoreLabel(type, tally)} />}
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-1.5">
          <span className="font-content-caption text-content-caption font-semibold uppercase tracking-[var(--fds-tracking-relaxed)] text-default-secondary">
            {label}
          </span>
          <TileInfo type={type} tally={tally} />
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {tally !== null && <Chip aria-hidden severity={heldSeverityBand(tally)} label={postureBandLabel(heldPostureBand(tally))} />}
          <span className="font-content-compact text-content-compact text-default-secondary">{testedTechniquesText(tested, shown)}</span>
        </span>
      </span>
    </div>
  );
};

interface TechniqueTestTilesProps {
  prevention: TestTally | null,
  detection: TestTally | null,
  testedPrevention: number,
  testedDetection: number,
  shown: number,
}

export const TechniqueTestTiles: FunctionComponent<TechniqueTestTilesProps> = ({ prevention, detection, testedPrevention, testedDetection, shown }) => (
  <div className="flex flex-wrap gap-3">
    <TestTile type="prevention" tally={prevention} tested={testedPrevention} shown={shown} />
    <TestTile type="detection" tally={detection} tested={testedDetection} shown={shown} />
  </div>
);
