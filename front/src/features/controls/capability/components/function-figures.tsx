import { plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { CapabilityFunction } from '@app/module/client';
import type { FunctionComponent } from 'react';
import type { CapabilityEdge } from '../types/capability';
import type { ProvenPosture } from '../utils/validation-summary-utils';
import { ProofMeter } from '../ui/proof-meter';
import { measuredPosture } from '../utils/function-posture-utils';
import { coveredTechniquesForFunction } from '../utils/technique-matrix-utils';
import { describeProofFreshness, formatRateReadout } from '../utils/validation-summary-utils';

const describeMisses = (isPrevention: boolean, missed: number): string =>
  (isPrevention
    ? plural(missed, { one: '# not prevented', other: '# not prevented' })
    : plural(missed, { one: '# not detected', other: '# not detected' }));

interface FunctionFiguresProps {
  capabilityFunction: CapabilityFunction,
  /** Every edge of the control: the figures keep only the ones of its own function. */
  edges: Array<CapabilityEdge>,
  /**
   * Absent when nothing can be measured at all: no simulation connector, or a control the catalogue
   * maps to no security platform family. The figures then state the credited perimeter alone, since
   * a coverage of zero would read as a gap someone could close. A posture crediting nothing is
   * treated the same way, for the same reason.
   */
  posture?: ProvenPosture,
  /** Such a control contests no technique of the scope, so a perimeter measurement would credit what it does not defend. */
  notDeployedOnScope: boolean,
}

/**
 * One function of the control, and the only place proven posture is stated: what the catalogue
 * credits this function with, how much of it a simulation has ever reached, and what that
 * measurement said.
 *
 * The credited perimeter leads whatever the simulations did, so the two functions always print the
 * same kind of figure and can be read against each other. Coverage and success rate answer different
 * questions and neither answers for the other, so both meters are drawn or neither.
 */
export const FunctionFigures: FunctionComponent<FunctionFiguresProps> = ({
  capabilityFunction,
  edges,
  posture,
  notDeployedOnScope,
}) => {
  const isPrevention = capabilityFunction === 'prevent';
  const covered = coveredTechniquesForFunction(edges, capabilityFunction);
  const unit = plural(covered.length, { one: 'technique covered', other: 'techniques covered' });
  const measured = measuredPosture(posture, notDeployedOnScope);
  const freshness = measured === null ? null : describeProofFreshness(measured.latestProofAt);

  return (
    <>
      <p className="txt-title tabular-nums leading-none">{covered.length}</p>
      <p className="txt-sub-content text-muted-foreground">{unit}</p>

      {notDeployedOnScope && (
        <p className="mt-4 text-muted-foreground"><Trans>Not deployed on this scope</Trans></p>
      )}

      {measured !== null && (
        <div className="mt-4 flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="txt-container-title text-muted-foreground"><Trans>Proof coverage</Trans></span>
            <span className="txt-sub-content tabular-nums">
              {formatRateReadout(measured.coverageRate, measured.tested, measured.credited)}
            </span>
          </div>
          <ProofMeter ratio={measured.coverageRate} tone="coverage" />
        </div>
      )}

      {/* A function nothing has tested carries no rate at all: the coverage row above already
          reads `0 / 502`, and a rate over an empty sample would be a figure with no measurement
          behind it. */}
      {measured !== null && measured.tested > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="txt-container-title text-muted-foreground"><Trans>Success rate</Trans></span>
            <span className="txt-sub-content tabular-nums">
              {formatRateReadout(measured.successRate, measured.met, measured.tested)}
            </span>
          </div>
          <ProofMeter ratio={measured.successRate} tone={measured.tone} />
          <p className="txt-sub-content text-muted-foreground">
            {measured.missed > 0 && describeMisses(isPrevention, measured.missed)}
            {measured.missed > 0 && freshness !== null && ' · '}
            {freshness}
          </p>
        </div>
      )}
    </>
  );
};
