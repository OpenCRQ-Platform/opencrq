import type { ScenarioReadiness } from '@app/module/client';
import { Card, CardHeader, CardOverview, CardTitle } from '@filigran/design-system';
import { EllipsisVertical } from 'lucide-react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { ScenarioAleChange, ScenarioLifelineSample } from './list';
import { EmptyValue } from '../../../components/ui/empty-value';
import { CARD_CONTENT_FILLS } from '../../../components/ui/card-content-fills';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { formatDollar, formatRelativeTime } from '../../../utils';
import {
  getScenarioInputLabel,
  ScenarioAleChangeCell,
  ScenarioBand,
  ScenarioLifeline,
  ScenarioReadinessFlag,
} from './list';

export interface RiskScenarioCardLatestRun {
  createdAt: string,
  aleMean: number | null,
  aleP10: number | null,
  aleP90: number | null,
}

export interface RiskScenarioCardProps {
  id: string,
  name: string,
  /** Null in an organization-scoped list, where naming it on every card says nothing. */
  organization: { id: string, name: string } | null,
  attackOutcome: { id: string, name: string },
  primaryAssets: Array<{ id: string, name: string }>,
  owner: { id: string, name: string | null } | null,
  latestRun: RiskScenarioCardLatestRun | null,
  lifeline: Array<ScenarioLifelineSample>,
  changeOverLifeline: ScenarioAleChange | null,
  readiness: ScenarioReadiness,
  onDelete: (id: string) => void,
  onNavigate: (id: string) => void,
  /** Opens the scope's asset mapping, the one place a scope with nothing to price can be answered from. */
  onManageAssets: () => void,
}

/**
 * The figure slot of a scenario that has never produced a run. It spends the same two lines a priced
 * figure does, the second one on why the first is empty, so an unpriced card is exactly as tall as
 * its neighbours.
 */
const UnpricedFigure: FunctionComponent<{ readiness: ScenarioReadiness, onManageAssets: () => void }> = ({ readiness, onManageAssets }) => {
  const missingInputs = readiness.missing.map(getScenarioInputLabel).join(', ');
  const noMappedAsset = readiness.status === 'no-mapped-asset';

  return (
    <>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="txt-subtitle2 text-muted-foreground"><Trans>Not priced</Trans></span>
        <span className="txt-sub-content truncate text-muted-foreground">
          {noMappedAsset ? t`No mapped asset` : readiness.missing.length > 0 ? t`Needs ${missingInputs}` : t`Ready to simulate`}
        </span>
      </span>
      {noMappedAsset ? (
        <button
          type="button"
          className="txt-sub-content whitespace-nowrap text-primary"
          // The card itself navigates to the scenario, and this affordance answers the scope.
          onClick={(event) => {
            event.stopPropagation();
            onManageAssets();
          }}
        >
          <Trans>Manage assets</Trans>
        </button>
      ) : (
        <span className="txt-sub-content whitespace-nowrap text-primary"><Trans>Simulate</Trans></span>
      )}
    </>
  );
};

export const RiskScenarioCard: FunctionComponent<RiskScenarioCardProps> = ({
  id,
  name,
  organization,
  attackOutcome,
  primaryAssets,
  owner,
  latestRun,
  lifeline,
  changeOverLifeline,
  readiness,
  onDelete,
  onNavigate,
  onManageAssets,
}) => {
  const targets = primaryAssets.map((asset) => asset.name).join(', ');
  // A run that produced no exposure leaves the same hole as no run at all, and the reader is owed
  // the same answer: what the figure is waiting on.
  const pricedRun = latestRun !== null && latestRun.aleMean !== null && readiness.status !== 'no-mapped-asset'
    ? latestRun
    : null;

  return (
    <Card
      gap={8}
      padding={16}
      className={`h-full ${CARD_CONTENT_FILLS}`}
      onClick={() => onNavigate(id)}
    >
      <CardHeader
        action={(
          <IconActions icon={<EllipsisVertical className="h-4 w-4 text-primary" />}>
            <IconActionsItem onClick={() => onDelete(id)}>
              <Trans>Delete</Trans>
            </IconActionsItem>
          </IconActions>
        )}
      >
        {organization !== null && (
          <CardOverview>{organization.name}</CardOverview>
        )}
        <CardTitle as="h3">{name}</CardTitle>
      </CardHeader>
      {/* Everything from the figure down is pushed to the bottom of the card, which the grid has
          already stretched to the tallest of its row: a one-line name then costs its own card the
          slack rather than putting its figure, lifeline and metadata at a height of their own. */}
      <div className="mt-auto flex min-h-11 items-baseline justify-between gap-2">
        {pricedRun === null
          ? <UnpricedFigure readiness={readiness} onManageAssets={onManageAssets} />
          : (
            // The change shares the figure's line, not the band's: beside the band, the wider of the
            // two, it runs out of a narrow card.
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <span className="txt-subtitle2 font-semibold tabular-nums text-foreground">
                  {formatDollar(pricedRun.aleMean)}
                </span>
                {/* No period label: the words do not fit beside the figure at card width. */}
                <ScenarioAleChangeCell
                  hasRun
                  change={changeOverLifeline === null
                    ? null
                    : { delta: changeOverLifeline.delta, deltaPct: changeOverLifeline.deltaPct }}
                />
              </span>
              <ScenarioBand p10={pricedRun.aleP10} p90={pricedRun.aleP90} format={formatDollar} />
            </span>
          )}
      </div>
      <ScenarioLifeline points={lifeline} />
      <dl className="txt-sub-content m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-1">
        <dt className="text-muted-foreground"><Trans>Outcome</Trans></dt>
        <dd className="m-0 truncate">{attackOutcome.name}</dd>
        <dt className="text-muted-foreground"><Trans>Targets</Trans></dt>
        <dd className="m-0 truncate">{targets === '' ? <EmptyValue /> : targets}</dd>
        <dt className="text-muted-foreground"><Trans>Owner</Trans></dt>
        <dd className="m-0 truncate">{owner?.name ?? <EmptyValue />}</dd>
        <dt className="text-muted-foreground"><Trans>Simulated</Trans></dt>
        <dd className="m-0 flex min-w-0 items-center gap-1.5">
          <span className="truncate">
            {latestRun === null ? <Trans>Never</Trans> : formatRelativeTime(latestRun.createdAt)}
          </span>
          {latestRun !== null && <ScenarioReadinessFlag readiness={readiness} />}
        </dd>
      </dl>
    </Card>
  );
};
