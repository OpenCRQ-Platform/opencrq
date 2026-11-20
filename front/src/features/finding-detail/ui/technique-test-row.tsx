import { plural, t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { FindingScoreBreakdown } from '../../finding-score';
import { MonoChip } from './mono-chip';

type TechniqueTest = FindingScoreBreakdown['columns']['techniqueTests'][number];
type TestScope = TechniqueTest['here'];
type Tally = NonNullable<TestScope['prevention']>;

/**
 * The two verbs are the platform's own, from the expectation it ran. They report what the run
 * observed on the technique, which is not the same claim as what the control beside them achieved:
 * a control standing through a prevent edge alone still sits next to a detection reading.
 *
 * Each reading is one message rather than a verb glued to a tally, so a translator can move the
 * figures inside the sentence and punctuate them.
 */
const preventionText = ({ held, total }: Tally): string => t`Prevented ${held}/${total}`;

const detectionText = ({ held, total }: Tally): string => t`Detected ${held}/${total}`;

const ScopeReading: FunctionComponent<{
  label: string,
  scope: TestScope,
  neverRunLabel: string,
  suffix?: string,
}> = ({ label, scope, neverRunLabel, suffix }) => (
  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
    <span className="w-14 shrink-0 font-content-caption text-content-caption uppercase tracking-[var(--fds-tracking-relaxed)] text-default-secondary">
      {label}
    </span>
    {scope.prevention === null && scope.detection === null ? (
      <span className="font-content-compact text-content-compact text-default-secondary">{neverRunLabel}</span>
    ) : (
      <>
        {scope.prevention !== null && (
          <span className="font-content-compact text-content-compact tabular-nums">
            {preventionText(scope.prevention)}
          </span>
        )}
        {scope.detection !== null && (
          <span className="font-content-compact text-content-compact tabular-nums">
            {detectionText(scope.detection)}
          </span>
        )}
        {suffix !== undefined && (
          <span className="font-content-compact text-content-compact text-default-secondary">{suffix}</span>
        )}
      </>
    )}
  </span>
);

/**
 * One technique a control stands on, and what a run said about it here and across the estate.
 *
 * A scope nothing ran at says so in words. A zero would say a run happened and held nothing, which
 * is a different statement and the one an analyst acts on.
 */
export const TechniqueTestRow: FunctionComponent<{ test: TechniqueTest }> = ({ test }) => {
  const fleetAssetCount = test.fleet.assetCount;
  return (
    <li className="flex flex-col gap-1 py-2">
      <span className="flex flex-wrap items-center gap-2">
        <MonoChip>{test.externalId}</MonoChip>
        <span className="font-content-base text-content-base">{test.name ?? test.externalId}</span>
      </span>
      <ScopeReading label={t`Here`} scope={test.here} neverRunLabel={t`Never tested here`} />
      <ScopeReading
        label={t`Fleet`}
        scope={test.fleet}
        neverRunLabel={t`Never tested anywhere`}
        suffix={fleetAssetCount > 0 ? plural(fleetAssetCount, { one: 'on # asset', other: 'on # assets' }) : undefined}
      />
    </li>
  );
};
