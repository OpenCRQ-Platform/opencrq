import { t } from '@lingui/core/macro';
import { Plural, Trans } from '@lingui/react/macro';
import { Skeleton } from '@filigran/ui';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { ControlIdPill, MetricInfo } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { cn, formatDollar, formatFixed } from '../../../utils';
import { groupMovesIntoTiers } from '../exposure-flow-utils';
import { Caption, Figure, MagnitudeBar, MetaChip, Panel, RankChip } from '../components/slick-primitives';

export type ControlDimension = 'strength' | 'coverage' | 'deploy';

export interface ControlMove {
  controlId: string,
  name: string,
  externalId: string,
  dimension: ControlDimension,
  aleReduction: number,
  scenarioCount: number,
}

const MAX_TIERS = 3;

const dimensionLabel = (dimension: ControlDimension): string => {
  switch (dimension) {
    case 'strength':
      return t`Strength`;
    case 'coverage':
      return t`Coverage`;
    case 'deploy':
      return t`Deploy`;
  }
};

interface SlickMovesWidgetProps {
  organizationId?: string,
  projectedControlId: string | null,
  onProject: (move: ControlMove | null) => void,
}

/**
 * The move list, restyled: rank chips, a magnitude bar per row so relative size reads without
 * arithmetic, and values right-aligned on tabular figures so the column is a column.
 *
 * Same wiring as `ControlMovesWidget`: `getTopControls`, the same 2× tiering, and the same
 * refusal to name a winner inside a tier.
 */
export const SlickMovesWidget: FunctionComponent<SlickMovesWidgetProps> = ({
  organizationId, projectedControlId, onProject,
}) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { data } = useQuery(trpc.dashboard.getTopControls.queryOptions({ organizationId }));

  const moves: Array<ControlMove> = (data ?? []).map((control) => ({
    controlId: control.controlId,
    name: control.name,
    externalId: control.externalId,
    dimension: control.suggestedDimension,
    aleReduction: control.totalAleReduction,
    scenarioCount: control.scenarioCount,
  }));
  const tiers = groupMovesIntoTiers(moves).slice(0, MAX_TIERS);
  // Bars are scaled against the largest move on screen, so the leading row is always full width
  // and every other row reads as a fraction of it.
  const peak = Math.max(...tiers.flatMap((tier) => tier.moves.map((move) => move.aleReduction)), 0);
  // Ranks are derived up front rather than counted during the nested render. A mutable counter
  // incremented inside the inner map is a reassignment after render completes, which the React
  // Compiler rejects outright.
  const rankByControl = new Map(
    tiers.flatMap((tier) => tier.moves).map((move, index) => [move.controlId, index + 1]),
  );

  return (
    <Panel
      title={<Trans>What to do next</Trans>}
      info={
        <MetricInfo
          title={t`What to do next`}
          what={<Trans>The control upgrades that would take the most annual loss off the table.</Trans>}
          how={
            <Trans>
              One row per control: the ALE reduction of its best single upgrade in each scenario,
              summed across the scenarios it appears in, so a control is credited once per scenario,
              not once per candidate upgrade. The chip names the axis to move. Rows within 2× of each
              other share a tier and are not ranked against one another, because a ±30% weight error
              would reorder them. Hover a row to project it onto the timeline; select it to open the
              control.
            </Trans>
          }
          caveat={
            <Trans>
              Do not add the column up. Every figure assumes the others do not happen, and controls
              overlap, so your second upgrade will be worth less than it says here. Take one, re-run
              the simulation, then read the list again. The figures are mean reductions of the
              annual loss exposure.
            </Trans>
          }
        />
      }
    >
      {data === undefined ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-10 w-full" />)}
        </div>
      ) : tiers.length === 0 ? (
        <p className="txt-sub-content text-muted-foreground py-10 text-center">
          <Trans>No control recommendation yet. Run simulations to compute what-if reductions.</Trans>
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {tiers.map((tier, tierIndex) => {
            const tierNumber = tierIndex + 1;
            const spread = formatFixed(tier.spread, 1);
            return (
              <div key={tierIndex} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <Caption><Trans>Tier {tierNumber}</Trans></Caption>
                  {tier.moves.length > 1 && (
                    <p className="txt-mini text-muted-foreground">
                      <Trans>{spread}× spread · interchangeable</Trans>
                    </p>
                  )}
                </div>
                {tier.moves.map((move) => {
                  const isProjected = projectedControlId === move.controlId;
                  return (
                    <button
                      key={move.controlId}
                      type="button"
                      className={cn(
                        'group hover:bg-muted/50 flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left transition-colors',
                        isProjected && 'bg-muted ring-1 ring-green-600/50 dark:ring-green-400/50',
                      )}
                      onMouseEnter={() => onProject(move)}
                      onMouseLeave={() => onProject(null)}
                      onFocus={() => onProject(move)}
                      onBlur={() => onProject(null)}
                      onClick={() => {
                        void navigate({
                          to: '/$tenantId/{-$organizationId}/controls/$controlId/overview',
                          params: (prev) => ({ tenantId: prev.tenantId ?? '', controlId: move.controlId }),
                        });
                      }}
                    >
                      <span className="flex w-full items-center gap-2">
                        <RankChip rank={rankByControl.get(move.controlId) ?? 0} />
                        <ControlIdPill externalId={move.externalId} size="compact" />
                        <span className="txt-table min-w-0 flex-1 truncate font-medium group-hover:underline">
                          {move.name}
                        </span>
                        <Figure className="txt-table shrink-0 text-green-600 dark:text-green-400">
                          −{formatDollar(move.aleReduction)}
                        </Figure>
                      </span>
                      <span className="flex w-full items-center gap-2 pl-7">
                        <MetaChip>{dimensionLabel(move.dimension)}</MetaChip>
                        <span className="txt-mini text-muted-foreground shrink-0">
                          <Plural value={move.scenarioCount} one="# scenario" other="# scenarios" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <MagnitudeBar
                            ratio={peak > 0 ? move.aleReduction / peak : 0}
                            className="bg-green-600/60 dark:bg-green-400/60"
                          />
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
};
