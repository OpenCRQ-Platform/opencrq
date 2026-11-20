import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate, useParams } from '@tanstack/react-router';
import type { CapabilityFunction } from '@app/module/client';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { HighlightedTechnique } from '../../../components/shared/ttp-matrix-cell';
import type { ThreatTechniqueRow } from './threat-ttp-utils';
import { DebouncedSearchField } from '../../../components/shared/debounced-search-field';
import { BadgeGroup } from '../../../components/ui/badge-group';
import { DataPageWithTtpMatrix } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { SegmentedCounts } from '../../../components/ui/segmented-counts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { useOpenCtiBaseUrl, usePersistedView, useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { resolveOptionFilter } from '../../../utils/option-filter-utils';
import { useOpenaevConnector } from '../../controls/capability/hooks/use-capability-validation';
import { MatrixLegend } from '../../controls/capability/ui/technique-cell-highlights';
import { isEfficacySegment } from '../../controls/capability/utils/control-technique-readings-utils';
import { FUNCTION_COLOR } from '../../controls/capability/utils/technique-matrix-utils';
import { buildOpenCtiObjectLink } from '../../supporting-assets/connectors-utils';
import { threatTechniquesListSearchSchema } from '../threat-techniques-list-search';
import { OpenCtiLink } from './opencti-link';
import { coverageOnFunction, shownReadingOf, threatTechniquesBySegment } from './threat-coverage-utils';
import {
  CoverageControlCell,
  CoverageDialog,
  CoverageEfficacyCell,
  CoverageResultCell,
  coverageSegments,
  plainTechniqueHighlight,
  techniqueCoverageHighlight,
} from './threat-technique-coverage';
import { filterThreatTechniques, revokedCitationNote, tacticsOfTechniques } from './threat-ttp-utils';

const STORAGE_KEY = 'threat-techniques';
const ALL_TACTICS = 'all';

interface ThreatTechniquesViewProps {
  threatId: string,
  techniques: Array<ThreatTechniqueRow>,
}

export const ThreatTechniquesView: FunctionComponent<ThreatTechniquesViewProps> = ({ threatId, techniques }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const openctiUrl = useOpenCtiBaseUrl();
  const { organizationId } = useParams({ strict: false });
  const isValidationAvailable = useOpenaevConnector().isConfigured === true;
  const [explainedTechniqueId, setExplainedTechniqueId] = useState<string | null>(null);
  // The search applies to the list only, so the matrix is never narrowed by it.
  const { view } = usePersistedView(STORAGE_KEY, 'matrix', ['table', 'matrix']);
  const { filters, setFilters } = useUrlListFilters(threatTechniquesListSearchSchema);
  const tactics = tacticsOfTechniques(techniques);
  const resolvedTactic = resolveOptionFilter(filters.tactic, tactics.map(({ id }) => id), '');
  const tacticId = resolvedTactic === '' ? null : resolvedTactic;
  const capabilityFunction = filters.function;

  const { data: coverages, isError } = useQuery(trpc.controlValidation.getTechniquesCoverage.queryOptions({
    threatId,
    organizationId: organizationId ?? null,
  }));
  const isUnavailable = coverages === undefined;
  const coverageOf = coverageOnFunction(coverages, capabilityFunction);

  const isList = view === 'table';
  const inTactic = filterThreatTechniques(techniques, { search: '', tacticId });
  const bySegment = threatTechniquesBySegment(inTactic.map((technique) => technique.id), coverageOf);
  const segment = isUnavailable ? 'all' : filters.result;
  const isInSegment = (techniqueId: string): boolean => segment === 'all' || bySegment[segment].has(techniqueId);
  const rows = filterThreatTechniques(techniques, { search: isList ? filters.search : '', tacticId })
    .filter((technique) => isInSegment(technique.id));
  const linksToOpenCti = techniques.some((technique) => buildOpenCtiObjectLink(openctiUrl, technique.openctiStixRelationId) !== null);

  const columns: Array<ColumnDefWithOptionsHeader<ThreatTechniqueRow, unknown>> = [
    {
      id: 'externalId',
      accessorKey: 'externalId',
      header: t`ID`,
      size: 120,
      cell: ({ row }): ReactElement => (
        <span className="whitespace-nowrap font-mono txt-sub-content text-muted-foreground">{row.original.externalId}</span>
      ),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 300,
      cell: ({ row }): ReactElement => {
        const note = revokedCitationNote(row.original.externalId, row.original.citedExternalIds);
        return (
          <span className="flex min-w-0 flex-col">
            <span className="whitespace-nowrap">{row.original.name}</span>
            {/* The title holds the note whole where the cell clips it. */}
            {note !== null && <span className="truncate txt-sub-content text-muted-foreground" title={note}>{note}</span>}
          </span>
        );
      },
    },
    {
      id: 'tactics',
      header: t`Tactics`,
      size: 220,
      enableSorting: false,
      cell: ({ row }): ReactElement => (row.original.tactics.length === 0
        ? <EmptyValue />
        : <BadgeGroup items={row.original.tactics.map((tactic) => ({ title: tactic.name }))} chipClassName="max-w-none" />),
    },
    {
      id: 'engineEfficacy',
      accessorFn: (row) => coverageOf.get(row.id)?.best?.efficacy,
      sortUndefined: 'last',
      sortDescFirst: true,
      header: t`Engine efficacy`,
      size: 190,
      cell: ({ row }): ReactElement => (
        <CoverageEfficacyCell
          technique={row.original}
          coverage={coverageOf.get(row.original.id)}
          isUnavailable={isUnavailable}
          isValidationAvailable={isValidationAvailable}
        />
      ),
    },
    {
      id: 'openaevResult',
      accessorFn: (row) => shownReadingOf(coverageOf.get(row.id))?.tested?.rate,
      sortUndefined: 'last',
      header: t`OpenAEV result`,
      size: 220,
      cell: ({ row }): ReactElement => <CoverageResultCell coverage={coverageOf.get(row.original.id)} isUnavailable={isUnavailable} />,
    },
    {
      id: 'control',
      accessorFn: (row) => shownReadingOf(coverageOf.get(row.id))?.capabilityExternalId,
      sortUndefined: 'last',
      header: t`Control`,
      size: 180,
      cell: ({ row }): ReactElement => <CoverageControlCell coverage={coverageOf.get(row.original.id)} />,
    },
    ...(linksToOpenCti
      ? [{
        id: 'opencti',
        header: t`OpenCTI`,
        size: 100,
        enableSorting: false,
        cell: ({ row }: { row: { original: ThreatTechniqueRow } }): ReactElement => (
          <span onClick={(event) => event.stopPropagation()}>
            <OpenCtiLink
              href={buildOpenCtiObjectLink(openctiUrl, row.original.openctiStixRelationId)}
              label={t`Open this relationship in OpenCTI`}
              iconOnly
            />
          </span>
        ),
      } satisfies ColumnDefWithOptionsHeader<ThreatTechniqueRow, unknown>]
      : []),
  ];

  const highlightedTechniques: Array<HighlightedTechnique> = rows.map((technique) => (isUnavailable
    ? plainTechniqueHighlight(technique, capabilityFunction)
    : techniqueCoverageHighlight(technique, coverageOf.get(technique.id), capabilityFunction, setExplainedTechniqueId)));

  const functionOptions: Array<{ key: CapabilityFunction, label: string }> = [
    { key: 'prevent', label: t`Prevention` },
    { key: 'detect', label: t`Detection` },
  ];

  const toolbarFilters = (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label={t`Function`} className="flex items-center gap-1 rounded-lg border p-0.5">
        {functionOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={option.key === capabilityFunction}
            onClick={() => setFilters({ function: option.key })}
            className={option.key === capabilityFunction
              ? 'rounded-md bg-primary/20 px-2 py-1 txt-sub-content text-primary'
              : 'rounded-md px-2 py-1 txt-sub-content hover:bg-hover'}
          >
            {option.label}
          </button>
        ))}
      </div>
      {!isUnavailable && (
        <SegmentedCounts
          segments={coverageSegments(inTactic.length, bySegment)}
          value={segment}
          onChange={(key) => {
            if (isEfficacySegment(key)) {
              setFilters({ result: key });
            }
          }}
          ariaLabel={capabilityFunction === 'prevent' ? t`Filter prevention by result` : t`Filter detection by result`}
        />
      )}
      {isError && isUnavailable && (
        <p className="txt-sub-content text-muted-foreground"><Trans>Could not load the coverage of these techniques.</Trans></p>
      )}
      {isList && (
        <DebouncedSearchField
          placeholder={t`Search techniques...`}
          value={filters.search}
          onCommit={(search) => setFilters({ search })}
          clearLabel={t`Clear search`}
          className="w-80"
        />
      )}
      <Select value={tacticId ?? ALL_TACTICS} onValueChange={(value) => setFilters({ tactic: value === ALL_TACTICS ? '' : value })}>
        <SelectTrigger className="w-56" aria-label={t`Filter by tactic`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_TACTICS}><Trans>All tactics</Trans></SelectItem>
          {tactics.map((tactic) => (
            <SelectItem key={tactic.id} value={tactic.id}>{tactic.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const explained = explainedTechniqueId === null ? undefined : techniques.find((technique) => technique.id === explainedTechniqueId);

  return (
    <>
      <DataPageWithTtpMatrix
        data={rows}
        columns={columns}
        storageKey={STORAGE_KEY}
        highlightedTechniques={highlightedTechniques}
        defaultColor={FUNCTION_COLOR[capabilityFunction]}
        defaultView="matrix"
        leftHeaderContent={toolbarFilters}
        forceHighlightedOnly={segment !== 'all'}
        matrixHeader={<MatrixLegend />}
        initialSorting={[{ id: 'externalId', desc: false }]}
        initialPageSize={20}
        matrixTacticIds={tacticId === null ? undefined : [tacticId]}
        onClickRow={(row) => {
          void navigate({
            to: '/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId',
            params: (prev) => ({ tenantId: prev.tenantId!, techniqueExternalId: row.original.externalId }),
          });
        }}
      />
      {explained !== undefined && (
        <CoverageDialog
          technique={explained}
          coverage={coverageOf.get(explained.id)}
          isValidationAvailable={isValidationAvailable}
          onClose={() => setExplainedTechniqueId(null)}
        />
      )}
    </>
  );
};
