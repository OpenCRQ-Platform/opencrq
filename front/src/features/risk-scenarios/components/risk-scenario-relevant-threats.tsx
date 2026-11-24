import type { ThreatEntityType } from '@app/module/client';
import { resolveSeverityBand } from '@app/module/client';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { ShieldAlert, Upload } from 'lucide-react';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SectionCard } from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { ScoreGaugeMark, severityBandLabel } from '../../finding-score';
import { useTRPC } from '../../../lib';
import { localTableStateCollection } from '../../../stores';
import {
  ActivityGradeBadge,
  composeThreatScore,
  DimensionTags,
  observedAtSortValue,
  RelevanceBand,
  RelevanceProofPanel,
  ResourceLevelValue,
  threatScoreSortKey,
  ThreatTypeBadge,
} from '../../threats';
import { HiddenThreatsAlert } from '../../threats/components/hidden-threats-notice';
import { useCounterparts, XtmRowMarks } from '../../xtm/xtm-counterparts';
import { WeighingRuleSentence } from './weighing-rule-sentence';
import { resolveRelevantThreatsEmptyState } from './risk-scenario-relevant-threats-utils';

interface RiskScenarioRelevantThreatsProps {
  riskScenarioId: string,
  riskScenarioName: string,
}

export const RELEVANT_THREATS_TABLE_ID = 'riskScenarioRelevantThreatsV2';

// The table shipped under this id before the V2 rewrite changed its column set; cleared once so an
// orphaned entry doesn't linger in every reader's `localStorage` forever.
const PREVIOUS_RELEVANT_THREATS_TABLE_ID = 'riskScenarioRelevantThreats';

export interface RelevantThreatRow {
  id: string,
  stixId: string,
  name: string,
  entityType: ThreatEntityType,
  activityScore: number | null,
  activityWeight: number,
  lastObservedAt: Date | string | null,
  combinedRelevance: number,
  resourceLevel: string | null,
  countries: Array<string>,
  sectors: Array<string>,
  matchedCountry: string | null,
  matchedSector: string | null,
}

const EmptyStatePanel: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <div className="flex flex-col items-center gap-4 py-12">
    <ShieldAlert className="h-12 w-12 text-muted-foreground" />
    {children}
  </div>
);

export const RiskScenarioRelevantThreats: FunctionComponent<RiskScenarioRelevantThreatsProps> = ({ riskScenarioId, riskScenarioName }) => {
  const trpc = useTRPC();
  const [selectedRow, setSelectedRow] = useState<RelevantThreatRow | null>(null);
  useEffect(() => {
    if (localTableStateCollection.has(PREVIOUS_RELEVANT_THREATS_TABLE_ID)) {
      localTableStateCollection.delete([PREVIOUS_RELEVANT_THREATS_TABLE_ID]);
    }
  }, []);
  // Radix restores focus to the node that was focused when the drawer opened; a background refetch
  // remounts that row and focus falls to `<body>`. The shipped `DataTable` row carries no tab stop,
  // so this container is the only stable node to hand focus back to.
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const { data: relevant, isLoading: isLoadingRelevant } = useQuery(trpc.threats.getRelevantForScenario.queryOptions(
    { scenarioId: riskScenarioId },
  ));
  const { data: hasAnyAnalyses, isLoading: isLoadingAnalyses } = useQuery(trpc.threats.hasAny.queryOptions());
  const isLoading = isLoadingRelevant || isLoadingAnalyses;

  const items = relevant?.items ?? [];
  // The same threats in OpenCTI and OpenAEV, by STIX id: one batched lookup, nothing while not connected.
  const counterparts = useCounterparts('THREAT', items.map((item) => item.stixId));
  const emptyState = isLoading ? null : resolveRelevantThreatsEmptyState({
    itemCount: items.length,
    hasAnyAnalyses: hasAnyAnalyses ?? false,
  });

  if (emptyState !== null) {
    return (
      <SectionCard title={t`Relevant Threats`}>
        <HiddenThreatsAlert />
        <EmptyStatePanel>
          <div className="text-center">
            <p className="txt-subtitle font-medium">
              {emptyState === 'no-analyses'
                ? <Trans>No threats imported yet</Trans>
                : <Trans>No relevant threats found</Trans>}
            </p>
            <p className="txt-sub-content text-muted-foreground">
              {emptyState === 'no-analyses'
                ? <Trans>Upload a STIX bundle to start analyzing threats.</Trans>
                : <WeighingRuleSentence />}
            </p>
          </div>
          <Link
            from="/$tenantId/{-$organizationId}"
            to="threat-center"
            className="txt-body2 text-primary hover:underline"
          >
            <span className="inline-flex items-center gap-1.5">
              <Upload className="h-4 w-4" />
              <Trans>Upload a bundle</Trans>
            </span>
          </Link>
        </EmptyStatePanel>
      </SectionCard>
    );
  }

  const columns: Array<ColumnDefWithOptionsHeader<RelevantThreatRow, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 180,
      cell: ({ row }): ReactElement => (
        <span className="inline-flex items-center gap-2">
          <span className="txt-default font-medium text-foreground">{row.original.name}</span>
          <XtmRowMarks counterparts={counterparts.filter((c) => c.key === row.original.stixId.toLowerCase())} />
        </span>
      ),
    },
    {
      id: 'score',
      accessorFn: (row: RelevantThreatRow): number => threatScoreSortKey(row.combinedRelevance, row.activityWeight),
      header: t`Score`,
      size: 90,
      cell: ({ row }): ReactElement => {
        const score = composeThreatScore(row.original.combinedRelevance, row.original.activityWeight);
        const band = resolveSeverityBand(score);
        const bandWord = severityBandLabel(band);
        return (
          <span className="flex h-full items-center gap-2">
            <span className="sr-only">{t`Opens the evidence behind this threat's score`}</span>
            <ScoreGaugeMark score={score} band={band} label={t`Threat score: ${score} out of 100, ${bandWord} band`} />
          </span>
        );
      },
    },
    {
      id: 'entityType',
      accessorKey: 'entityType',
      header: t`Type`,
      size: 140,
      cell: ({ row }): ReactElement => <ThreatTypeBadge entityType={row.original.entityType} />,
    },
    {
      id: 'relevance',
      accessorFn: (row: RelevantThreatRow): number => row.combinedRelevance,
      header: t`Relevance`,
      size: 160,
      cell: ({ row }): ReactElement => <RelevanceBand relevance={row.original.combinedRelevance} />,
    },
    {
      id: 'activity',
      accessorFn: (row: RelevantThreatRow) => observedAtSortValue(row.lastObservedAt),
      sortUndefined: 'last',
      sortDescFirst: true,
      header: t`Observed activity`,
      size: 150,
      cell: ({ row }): ReactElement => (
        <ActivityGradeBadge lastObservedAt={row.original.lastObservedAt} />
      ),
    },
    {
      id: 'resourceLevel',
      header: t`Resource level`,
      size: 130,
      enableSorting: false,
      cell: ({ row }): ReactElement => <ResourceLevelValue value={row.original.resourceLevel} />,
    },
    {
      id: 'countries',
      header: t`Countries`,
      size: 220,
      enableSorting: false,
      cell: ({ row }): ReactElement => (
        <DimensionTags kind="country" values={row.original.countries} matchedValue={row.original.matchedCountry} />
      ),
    },
    {
      id: 'sectors',
      header: t`Sectors`,
      size: 220,
      enableSorting: false,
      cell: ({ row }): ReactElement => (
        <DimensionTags kind="sector" values={row.original.sectors} matchedValue={row.original.matchedSector} />
      ),
    },
  ];

  return (
    <SectionCard title={t`Relevant Threats`}>
      <HiddenThreatsAlert />
      <div ref={tableContainerRef} tabIndex={-1}>
        <DataPageLayout
          data={items}
          isLoading={isLoading}
          columns={columns}
          storageKey={RELEVANT_THREATS_TABLE_ID}
          search={{ placeholder: t`Search threats...`, texts: (threat) => [threat.name] }}
          initialSorting={[{ id: 'score', desc: true }]}
          onClickRow={(row) => setSelectedRow(row.original)}
        />
      </div>
      <RelevanceProofPanel
        target={selectedRow && {
          scenarioId: riskScenarioId,
          scenarioName: riskScenarioName,
          analysisId: selectedRow.id,
          name: selectedRow.name,
          combinedRelevance: selectedRow.combinedRelevance,
          resourceLevel: selectedRow.resourceLevel,
          countries: selectedRow.countries,
          sectors: selectedRow.sectors,
          matchedCountry: selectedRow.matchedCountry,
          matchedSector: selectedRow.matchedSector,
        }}
        onClose={() => setSelectedRow(null)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          tableContainerRef.current?.focus();
        }}
      />
    </SectionCard>
  );
};
