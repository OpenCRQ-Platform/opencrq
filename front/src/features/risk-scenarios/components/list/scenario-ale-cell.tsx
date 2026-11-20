import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { EmptyValue } from '../../../../components/ui/empty-value';
import { formatDollar } from '../../../../utils';
import { ScenarioBand } from './scenario-band';

interface ScenarioAleCellProps {
  latestRun: { aleMean: number | null, aleP10: number | null, aleP90: number | null } | null,
  /** True when the scope holds nothing to price, which retires whatever figure is on file. */
  noMappedAsset: boolean,
}

/**
 * A scenario with no run reads as unmeasured, never as zero exposure. A run that produced no ALE is
 * left to the readiness badge to explain: the inputs it needed were missing.
 */
export const ScenarioAleCell: FunctionComponent<ScenarioAleCellProps> = ({ latestRun, noMappedAsset }) => {
  if (noMappedAsset) {
    return (
      <span className="txt-sub-content text-muted-foreground whitespace-nowrap">
        <Trans>Not priced</Trans>
      </span>
    );
  }
  if (!latestRun) {
    return (
      <span className="txt-sub-content text-muted-foreground whitespace-nowrap">
        <Trans>Not simulated</Trans>
      </span>
    );
  }
  const { aleMean, aleP10, aleP90 } = latestRun;
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-medium tabular-nums">
        {aleMean === null ? <EmptyValue /> : formatDollar(aleMean)}
      </span>
      {aleMean !== null && <ScenarioBand p10={aleP10} p90={aleP90} format={formatDollar} />}
    </span>
  );
};
