import type { ColumnDefWithOptionsHeader } from '../../../../components/ui/data-table-types';
import type { CapabilityFunction, EvidenceLineSortKey } from '@app/module/client';
import { EVIDENCE_LINE_SORT_KEYS } from '@app/module/client';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { SecurityPlatformFamily } from '../types/capability';
import type { ValidationEvidenceLine } from '../types/validation';
import type { EvidenceFunctionFilter, EvidenceResultFilter } from '../capability-validation-evidence-list-search';
import { SingleSelectField } from '../../../../components/shared';
import { DataPageLayout } from '../../../../components/ui/data-page-layout';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';
import { usePersistedPageSize, usePersistedSorting, useUrlListFilters } from '../../../../hooks';
import { useTRPC } from '../../../../lib';
import { cn, formatDate, formatNumber } from '../../../../utils';
import { buildLinks } from '../../../supporting-assets/connectors-utils';
import { capabilityValidationEvidenceListSearchSchema } from '../capability-validation-evidence-list-search';
import { FunctionBadge, functionLabel } from '../ui/function-badge';
import { ValidationStateBadge } from '../ui/validation-state-badge';
import { evidenceLineFilters, heldShare, isFiltered, techniqueFilterOptions } from '../utils/validation-evidence-utils';
import { formatBoundedRate } from '../utils/validation-summary-utils';

interface CapabilityValidationEvidenceProps {
  capabilityId: string,
  /** Read-only reference rows of the control, used to name the family behind its integration key. */
  securityPlatformFamilies: Array<SecurityPlatformFamily>,
  openaevUrl: string | null,
}

type EvidenceRow = ValidationEvidenceLine & { id: string }

const TABLE_ID = 'capability-validation-evidence';
const PAGE_LIMIT = 50;
const DEFAULT_SORTING = [{ id: 'technique', desc: false }];
const ALL_FAMILIES = 'all';
// Each sortable column is named after the sort key the server orders it on.
const isSortKey = (id: string): id is EvidenceLineSortKey => (EVIDENCE_LINE_SORT_KEYS as ReadonlyArray<string>).includes(id);

const toFunctionFilter = (value: string): EvidenceFunctionFilter => (value === 'prevent' || value === 'detect' ? value : 'all');
const toResultFilter = (value: string): EvidenceResultFilter => (value === 'validated' || value === 'contradicted' ? value : 'all');

// One translatable unit per function: the participle is the function's, and agrees with the count.
const assetRatioLabel = (capabilityFunction: CapabilityFunction, validatedCount: number, held: string, total: string, percent: string): string => (
  capabilityFunction === 'prevent'
    ? plural(validatedCount, { one: `${held}/${total} prevented (${percent})`, other: `${held}/${total} prevented (${percent})` })
    : plural(validatedCount, { one: `${held}/${total} detected (${percent})`, other: `${held}/${total} detected (${percent})` })
);

export const CapabilityValidationEvidence = ({
  capabilityId,
  securityPlatformFamilies,
  openaevUrl,
}: CapabilityValidationEvidenceProps): ReactNode => {
  const trpc = useTRPC();
  const { organizationId } = useParams({ strict: false });
  const { pageSize } = usePersistedPageSize(TABLE_ID, PAGE_LIMIT);
  const { sorting } = usePersistedSorting(TABLE_ID, DEFAULT_SORTING);
  const { filters: search, setFilters } = useUrlListFilters(capabilityValidationEvidenceListSearchSchema);
  const filters = evidenceLineFilters(search, securityPlatformFamilies.map((family) => family.platformTypeKey));
  // A page belongs to the filters it was turned on: changing one starts the list over.
  const filterKey = JSON.stringify(filters);
  const [paging, setPaging] = useState({ filterKey, pageIndex: 0 });
  const pageIndex = paging.filterKey === filterKey ? paging.pageIndex : 0;
  const [activeSort] = sorting;
  const { data, isLoading, isPlaceholderData, isFetching, isError } = useQuery(trpc.controlValidation.listControlValidationEvidence.queryOptions(
    {
      capabilityId,
      organizationId,
      ...filters,
      page: pageIndex + 1,
      limit: pageSize,
      sortBy: activeSort !== undefined && isSortKey(activeSort.id) ? activeSort.id : undefined,
      sortDesc: activeSort?.desc ?? false,
    },
    { placeholderData: keepPreviousData },
  ));
  const { data: techniques } = useQuery(trpc.controlValidation.listControlValidationEvidenceTechniques.queryOptions({ capabilityId, organizationId }));

  const familyName = new Map(securityPlatformFamilies.map((family) => [family.platformTypeKey, family.name]));
  const techniqueName = new Map((techniques ?? []).map((technique) => [technique.externalId, technique.name]));
  // Technique, function, family and vote key: the key the server derives the line on.
  const rows: Array<EvidenceRow> = (data?.items ?? []).map((line) => ({
    ...line,
    id: `${line.techniqueId}:${line.function}:${line.securityPlatformType}:${line.scenarioId ?? line.simulationId ?? ''}`,
  }));

  const columns: Array<ColumnDefWithOptionsHeader<EvidenceRow, unknown>> = [
    {
      id: 'technique',
      accessorKey: 'techniqueExternalId',
      header: t`Technique`,
      size: 260,
      cell: ({ row }) => (
        <span className="flex items-baseline gap-2 txt-sub-content">
          <span className="font-mono">{row.original.techniqueExternalId}</span>
          <span className="truncate">{techniqueName.get(row.original.techniqueExternalId)}</span>
        </span>
      ),
    },
    {
      id: 'scenario',
      accessorKey: 'scenarioName',
      header: t`Scenario`,
      size: 240,
      cell: ({ row }) => row.original.scenarioName ?? <span className="text-muted-foreground">{t`Unnamed scenario`}</span>,
    },
    {
      id: 'family',
      accessorKey: 'securityPlatformType',
      header: t`Platform family`,
      size: 200,
      cell: ({ row }) => familyName.get(row.original.securityPlatformType) ?? row.original.securityPlatformType,
    },
    {
      id: 'function',
      accessorKey: 'function',
      header: t`Function`,
      size: 120,
      cell: ({ row }) => <FunctionBadge value={row.original.function} />,
    },
    {
      id: 'verdict',
      accessorKey: 'verdict',
      header: t`Result`,
      size: 140,
      // One result holds one verdict, so its rate is the verdict itself and the badge shows the
      // word alone.
      cell: ({ row }) => (
        <ValidationStateBadge
          capabilityFunction={row.original.function}
          successRate={row.original.verdict === 'validated' ? 1 : 0}
        />
      ),
    },
    {
      id: 'evaluatedAt',
      accessorKey: 'evaluatedAt',
      header: t`Evaluated`,
      size: 140,
      cell: ({ row }) => formatDate(row.original.evaluatedAt),
    },
    {
      id: 'assets',
      accessorKey: 'assetCounts',
      header: t`Tested assets`,
      size: 220,
      cell: ({ row }) => {
        const { assetCounts } = row.original;
        const label = assetRatioLabel(
          row.original.function,
          assetCounts.validated,
          formatNumber(assetCounts.validated),
          formatNumber(assetCounts.validated + assetCounts.contradicted),
          formatBoundedRate(heldShare(assetCounts)),
        );
        return <span className={cn('txt-sub-content', assetCounts.contradicted > 0 && 'font-medium text-destructive')}>{label}</span>;
      },
    },
    {
      id: 'source',
      accessorKey: 'simulationId',
      header: '',
      size: 160,
      enableSorting: false,
      cell: ({ row }) => {
        // Technique expectation evidence is written by the OpenAEV sync alone, so the line needs no
        // connector of its own to know which product to link into.
        const links = buildLinks({
          connectorSource: 'openaev',
          sourceScenarioId: row.original.scenarioId,
          sourceSimulationId: row.original.simulationId,
          sourceInjectId: null,
          sourceFindingId: null,
          openaevUrl,
        });
        if (links.simulation === undefined) {
          return null;
        }
        return (
          <a
            href={links.simulation}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
          >
            <Trans>Open in OpenAEV</Trans>
            <ExternalLink className="size-3" />
          </a>
        );
      },
    },
  ];

  // A failed read must never wear the empty state: "no evidence" is a claim about the estate.
  if (isError) {
    return (
      <p role="alert" className="txt-sub-content text-muted-foreground">
        <Trans>The validation evidence could not be read. Reload the page to try again.</Trans>
      </p>
    );
  }

  const filterBar = (
    <>
      <div className="w-80">
        <SingleSelectField
          label={t`Filter by technique`}
          hideLabel
          placeholder={t`All techniques`}
          emptyMessage={t`No technique found`}
          options={techniqueFilterOptions(techniques, filters.technique)}
          value={filters.technique ?? null}
          onChange={(technique) => setFilters({ technique: technique ?? undefined })}
        />
      </div>
      <Select value={search.function} onValueChange={(value) => setFilters({ function: toFunctionFilter(value) })}>
        <SelectTrigger className="w-44" aria-label={t`Filter by function`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all"><Trans>All functions</Trans></SelectItem>
          <SelectItem value="prevent">{functionLabel('prevent')}</SelectItem>
          <SelectItem value="detect">{functionLabel('detect')}</SelectItem>
        </SelectContent>
      </Select>
      <Select value={search.result} onValueChange={(value) => setFilters({ result: toResultFilter(value) })}>
        <SelectTrigger className="w-64" aria-label={t`Filter by result`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all"><Trans>All results</Trans></SelectItem>
          <SelectItem value="validated"><Trans>Held on every asset</Trans></SelectItem>
          <SelectItem value="contradicted"><Trans>Gave way on an asset</Trans></SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={filters.securityPlatformType ?? ALL_FAMILIES}
        onValueChange={(value) => setFilters({ family: value === ALL_FAMILIES ? undefined : value })}
      >
        <SelectTrigger className="w-56" aria-label={t`Filter by platform family`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_FAMILIES}><Trans>All platform families</Trans></SelectItem>
          {securityPlatformFamilies.map((family) => (
            <SelectItem key={family.platformTypeKey} value={family.platformTypeKey}>{family.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );

  return (
    <DataPageLayout
      data={rows}
      total={data?.total ?? 0}
      columns={columns}
      storageKey={TABLE_ID}
      isLoading={isLoading}
      isPlaceholderData={isPlaceholderData}
      isFetching={isFetching}
      initialPageSize={PAGE_LIMIT}
      initialSorting={DEFAULT_SORTING}
      serverSorted
      pageIndex={pageIndex}
      onServerPageChange={(pagination) => setPaging({ filterKey, pageIndex: pagination.pageIndex })}
      leftHeaderContent={filterBar}
      emptyState={(
        <p className="txt-sub-content text-muted-foreground">
          {/* The control-wide claim is only true when the unfiltered response is empty: a stale
              filter must not state an estate that has evidence as having none. */}
          {isFiltered(filters) && (data?.unfilteredTotal ?? 0) > 0
            ? <Trans>No evidence line matches the filters. Clear the filters to see every line.</Trans>
            : <Trans>No simulation has produced evidence for this control yet.</Trans>}
        </p>
      )}
    />
  );
};
