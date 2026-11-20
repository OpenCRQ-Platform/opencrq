import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { useId } from 'react';
import type { VocabularyField } from '../data/stix-vocabulary-definitions';
import { roundPercentPoints } from '@app/utils/decimals';
import { notStatedDefinition, vocabularyDefinition } from '../data/stix-vocabulary-definitions';
import { categoricalChartColor } from '../../../components/shared/chart-utils';
import { TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { ChartSwatch } from '../../../components/ui/chart-segment';
import { SegmentBar } from '../../../components/ui/segment-bar';
import { useTheme } from '../../../providers';

// Prefixed: `bucket.value` is STIX free text, so an actor may literally declare "not-stated" and
// collide with the unstated bucket's key.
const bucketKey = (value: string | null): string => (value === null ? 'unstated' : `stated:${value}`);

interface DistributionBucket {
  value: string | null,
  count: number,
  share: number,
}

interface ThreatDistributionBarProps {
  label: string,
  field: VocabularyField,
  /** Precomputed server-side (`bucketDistribution`): the unstated bucket, if any, is always last. */
  buckets: ReadonlyArray<DistributionBucket>,
}

/**
 * One segmented bar over the given buckets, `Not stated` carried as its own hatched segment at its
 * true width. Values are STIX free text rendered verbatim — never translated, never ranked, never
 * recased.
 */
export const ThreatDistributionBar: FunctionComponent<ThreatDistributionBarProps> = ({ label, field, buckets }) => {
  const labelId = useId();
  const legendId = useId();
  const { effectiveTheme } = useTheme();
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  // Only stated buckets draw from the categorical ramp — the unstated one is always last and
  // never counts toward it, or it would shift colour depending on whether it is even present.
  const statedBuckets = buckets.filter((bucket) => bucket.value !== null);
  // Keyed by bucket, not by position: a legend row looks its colour up by the same key it renders,
  // rather than trusting it sits at the same index as its segment.
  const colorByKey = new Map(statedBuckets.map((bucket, index) => [
    bucketKey(bucket.value),
    categoricalChartColor(effectiveTheme, index, statedBuckets.length),
  ]));
  const segments = statedBuckets.map((bucket) => ({
    key: bucketKey(bucket.value),
    value: bucket.count,
    color: colorByKey.get(bucketKey(bucket.value))!,
  }));

  return (
    <div>
      <p id={labelId} className="txt-sub-content text-muted-foreground mb-1">{label}</p>
      <SegmentBar
        ariaDescribedBy={legendId}
        ariaLabelledBy={labelId}
        hatchedCount={buckets.find((bucket) => bucket.value === null)?.count}
        height="h-3"
        segments={segments}
        total={total}
      />
      <TooltipHintProvider>
        <ul id={legendId} className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
          {buckets.map((bucket) => {
            const sharePercent = roundPercentPoints(bucket.share, 0);
            const count = bucket.count;
            return (
              <li key={bucketKey(bucket.value)} className="txt-sub-content flex items-center gap-1.5">
                <ChartSwatch color={colorByKey.get(bucketKey(bucket.value))} />
                <TooltipHint hint={bucket.value === null ? notStatedDefinition(field) : vocabularyDefinition(field, bucket.value)}>
                  <span tabIndex={0} className="decoration-dotted underline-offset-2 cursor-default">
                    {bucket.value ?? t`Not stated`}
                  </span>
                </TooltipHint>
                <span className="text-muted-foreground">
                  <Trans>{count} ({sharePercent}%)</Trans>
                </span>
              </li>
            );
          })}
        </ul>
      </TooltipHintProvider>
    </div>
  );
};
