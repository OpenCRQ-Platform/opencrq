import { includesFolded } from '@app/utils/text-fold';
import { Button, Chip, Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import type { ColumnDefWithOptionsHeader, SelectionState } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import type { CrqControlWhatIfZeroReason } from '@app/module/client';
import type { PlanLever } from '../../treatment-plans/treatment-plan-utils';
import type { DimensionReading } from '../../controls/capability/ui/capability-dimension-cells';
import type { ControlRow, WhatIfEntry } from '../use-scenario-control-rows';
import { useScenarioControlRows } from '../use-scenario-control-rows';
import { isMaximalStep } from '../scenario-control-rows-utils';
import { showsDeclaredNotDeployed } from '../risk-scenario-utils';
import { ControlIdPill, DebouncedSearchField, InfoTooltip, TooltipHintProvider } from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { CoverageCell, EffectivenessCell, StrengthCell } from '../../controls/capability/ui/capability-dimension-cells';
import { TreatmentPlanAddDrawer } from '../../treatment-plans/components/treatment-plan-add-drawer';
import { AleReductionFigure } from './ale-reduction-figure';
import { ControlEvolutionBadges } from './control-evolution-badges';
import { leverDimensionLabel } from './lever-dimension-label';
import { FigureFamilyDate } from './figure-family-date';
import { ScenarioConfigurationAccordion } from './scenario-configuration-accordion';
import { ScenarioMixturePendingNotice } from './scenario-mixture-pending-notice';
import { useMissingDataItems } from './use-missing-data-items';

const zeroReasonHint = (reason: CrqControlWhatIfZeroReason): ReactNode => {
  switch (reason) {
    case 'actor-repertoire':
      return <Trans>Worth nothing here because the attackers behind this scenario do not use any technique this control covers. It is a statement about the actors, not about the control.</Trans>;
    case 'estate-families':
      return <Trans>Worth nothing here because this control protects no asset family the scenario's estate holds.</Trans>;
    case 'already-maximal':
      return <Trans>This axis is already at its ceiling, so there is nothing left to raise.</Trans>;
  }
};

const ReductionCell = ({ suggestion, baselineAle }: { suggestion: WhatIfEntry, baselineAle: number | null }) => {
  const mean = suggestion.aleReductionMean;
  if (mean === null) {
    return <EmptyValue />;
  }
  if (mean <= 0) {
    return (
      <div className="flex items-center gap-1">
        <EmptyValue />
        <InfoTooltip label={t`Why this lever is worth nothing`}>
          {suggestion.zeroReason !== null
            ? zeroReasonHint(suggestion.zeroReason)
            : <Trans>Upgrading this control does not reduce the simulated annual loss: the techniques it covers are already held by other controls on the same assets.</Trans>}
        </InfoTooltip>
      </div>
    );
  }
  return <AleReductionFigure mean={mean} p10={suggestion.aleReductionP10} p90={suggestion.aleReductionP90} baselineAle={baselineAle} />;
};

interface RiskScenarioControlsProps {
  riskScenarioId: string,
  organizationId: string,
  attackOutcomeId: string,
}

/** One table row = one lever the run priced for a control (or a control with none). */
interface SuggestionRow {
  /** Unique per row: `<controlId>` alone, or `<controlId>-<dimension>` when it carries a lever. */
  id: string,
  control: ControlRow,
  suggestion: WhatIfEntry | null,
}

const readingOf = (control: ControlRow): DimensionReading | null => (control.isAssessed
  ? {
    strengthRung: control.strengthRung,
    coverageBucket: control.coverageBucket,
  }
  : null);

const NO_SELECTION: SelectionState = { selectAll: false, selectedIds: new Set(), excludedIds: new Set() };

const leverOf = ({ control, suggestion }: SuggestionRow): PlanLever => ({
  capabilityId: control.id,
  dimension: suggestion?.dimension ?? null,
  upgradedStrength: suggestion?.upgradedStrength ?? null,
  upgradedCoverage: suggestion?.upgradedCoverage ?? null,
});

export const RiskScenarioControls: FunctionComponent<RiskScenarioControlsProps> = ({ riskScenarioId, organizationId, attackOutcomeId }) => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<SelectionState>(NO_SELECTION);
  const [addDrawerOpen, setAddDrawerOpen] = useState(false);

  const {
    tableData,
    whatIfByControl,
    hasWhatIfData,
    isWhatIfStale,
    maxedControlIds,
    scenarioTtpIds,
    latestRun,
    isMixturePending,
    isLoading,
  } = useScenarioControlRows({ riskScenarioId, organizationId, attackOutcomeId });

  const configItems = useMissingDataItems({
    riskScenarioId,
    whatIfStale: isWhatIfStale,
    currentLabel: 'controls' as const,
  });

  if (isMixturePending) {
    return <ScenarioMixturePendingNotice />;
  }

  if (scenarioTtpIds.length === 0) {
    return <p className="txt-sub-content text-muted-foreground"><Trans>No TTPs associated with this scenario.</Trans></p>;
  }

  const baselineAle = latestRun?.aleMean ?? null;

  // The run never writes a lever that cannot move the answer, so a row's absence is the shape of the
  // declaration. A control with no priced lever still appears once so the inventory stays complete.
  const suggestionRows: Array<SuggestionRow> = hasWhatIfData
    ? tableData
      .flatMap((control): Array<SuggestionRow> => {
        const entries = whatIfByControl.get(control.id) ?? [];
        return entries.length === 0
          ? [{ id: control.id, control, suggestion: null }]
          : entries.map((suggestion) => ({ id: `${control.id}-${suggestion.dimension}`, control, suggestion }));
      })
      .sort((a, b) => {
        const gainA = a.suggestion?.aleReductionMean ?? null;
        const gainB = b.suggestion?.aleReductionMean ?? null;
        if (gainA === null) {
          return gainB === null ? 0 : 1;
        }
        if (gainB === null) {
          return -1;
        }
        return gainB - gainA;
      })
    : tableData.map((control): SuggestionRow => ({ id: control.id, control, suggestion: null }));

  const visibleRows = suggestionRows.filter(({ control }) => includesFolded(control.name, search) || includesFolded(control.externalId, search));
  // "Select all" names the rows on screen, so it follows the search rather than the whole list.
  const selectedRows = selection.selectAll
    ? visibleRows.filter((row) => !selection.excludedIds.has(row.id))
    : suggestionRows.filter((row) => selection.selectedIds.has(row.id));

  const columns: Array<ColumnDefWithOptionsHeader<SuggestionRow, unknown>> = [
    {
      id: 'externalId',
      header: t`ID`,
      size: 80,
      enableSorting: false,
      cell: ({ row }): ReactElement => <ControlIdPill externalId={row.original.control.externalId} />,
    },
    {
      id: 'name',
      header: t`Name`,
      size: 280,
      cell: ({ row }): ReactElement => {
        const { name, isDeployed, isAssessed } = row.original.control;
        return (
          <span className="flex items-center gap-x-2">
            {showsDeclaredNotDeployed(isDeployed, isAssessed) && <Chip label={t`Not deployed`} />}
            <span className={isDeployed ? '' : 'text-muted-foreground'}>{name}</span>
          </span>
        );
      },
    },
    {
      id: 'strength',
      header: t`Strength`,
      size: 130,
      cell: ({ row }): ReactElement => <StrengthCell reading={readingOf(row.original.control)} />,
    },
    {
      id: 'coverage',
      header: t`Coverage`,
      size: 130,
      cell: ({ row }): ReactElement => <CoverageCell reading={readingOf(row.original.control)} />,
    },
    {
      id: 'effectiveness',
      header: t`Effectiveness`,
      size: 150,
      cell: ({ row }): ReactElement => <EffectivenessCell reading={readingOf(row.original.control)} />,
    },
    {
      id: 'ttps',
      header: t`TTP`,
      size: 150,
      cell: ({ row }): ReactElement => {
        const { ttps } = row.original.control;
        return (
          <TooltipHintProvider>
            <Tooltip>
              <TooltipTrigger>
                <Chip label={String(ttps.length)} />
              </TooltipTrigger>
              <TooltipContent side="top">
                {ttps.map((tech) => tech.externalId).join(', ')}
              </TooltipContent>
            </Tooltip>
          </TooltipHintProvider>
        );
      },
    },
    ...(hasWhatIfData ? [
      {
        id: 'change',
        header: t({ message: 'Change', context: 'kind of control move' }),
        size: 120,
        cell: ({ row }: { row: { original: SuggestionRow } }): ReactElement => {
          const { suggestion } = row.original;
          return suggestion ? <Chip label={leverDimensionLabel(suggestion.dimension)} /> : <EmptyValue />;
        },
      },
      {
        id: 'step',
        header: t`Step`,
        size: 260,
        cell: ({ row }: { row: { original: SuggestionRow } }): ReactElement => {
          const { control, suggestion } = row.original;
          if (!suggestion) {
            return maxedControlIds.has(control.id) ? <Chip label={t`Already at maximum`} /> : <EmptyValue />;
          }
          if (isMaximalStep(suggestion)) {
            return <Chip label={t`Already at maximum`} />;
          }
          return (
            <ControlEvolutionBadges
              dimension={suggestion.dimension}
              currentStrength={suggestion.currentStrength}
              upgradedStrength={suggestion.upgradedStrength}
              currentCoverage={suggestion.currentCoverage}
              upgradedCoverage={suggestion.upgradedCoverage}
            />
          );
        },
      },
      {
        id: 'aleReduction',
        header: t`ALE Reduction`,
        size: 220,
        cell: ({ row }: { row: { original: SuggestionRow } }): ReactElement => {
          const { suggestion } = row.original;
          if (!suggestion) {
            return <EmptyValue />;
          }
          return <ReductionCell suggestion={suggestion} baselineAle={baselineAle} />;
        },
      },
    ] as Array<ColumnDefWithOptionsHeader<SuggestionRow, unknown>> : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <ScenarioConfigurationAccordion items={configItems} />

      <div className="flex items-center gap-2">
        <h2><Trans>How to strengthen your defence</Trans></h2>
        <InfoTooltip label={t`How these reductions are computed`}>
          <span><Trans>Each reduction is the mean annual loss one move removes, priced exactly on the run's own worlds, with its spread underneath. A flask marks a spread wider than the gain: test that control before investing on the figure.</Trans></span>
          <span><Trans>Reductions do not add up: each one is priced alone, and two controls covering the same technique remove less together than the sum of their figures.</Trans></span>
        </InfoTooltip>
        <div className="ml-auto">
          <FigureFamilyDate riskScenarioId={riskScenarioId} family="levers" />
        </div>
      </div>

      {!hasWhatIfData && latestRun == null && (
        <p className="txt-sub-content text-muted-foreground">
          <Trans>Run a CRQ simulation to see the impact of improving each control's strength or coverage.</Trans>
        </p>
      )}

      <DataPageLayout
        data={visibleRows}
        columns={columns}
        isLoading={isLoading}
        storageKey="riskScenarioControls"
        enableSorting={false}
        leftHeaderContent={(
          <DebouncedSearchField
            value={search}
            onCommit={setSearch}
            clearLabel={t`Clear the search`}
            aria-label={t`Search for a control`}
            placeholder={t`Search for a control`}
            className="w-80"
          />
        )}
        selectionOptions={{
          selectionState: { state: selection, onSelectionChange: setSelection },
          selectionHeader: {
            actions: () => (
              <Button type="button" priority="secondary" size="sm" onClick={() => setAddDrawerOpen(true)}>
                <Trans>Add to a treatment plan</Trans>
              </Button>
            ),
          },
        }}
        onClickRow={(row) => {
          void navigate({
            to: '/$tenantId/{-$organizationId}/controls/$controlId',
            params: (prev) => ({ tenantId: prev.tenantId!, controlId: row.original.control.id }),
          });
        }}
      />

      <TreatmentPlanAddDrawer
        open={addDrawerOpen}
        onOpenChange={setAddDrawerOpen}
        organizationId={organizationId}
        levers={selectedRows.map(leverOf)}
        onAdded={() => setSelection(NO_SELECTION)}
      />
    </div>
  );
};
