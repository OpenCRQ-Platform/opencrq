import { Button } from '@filigran/design-system';
import { useToast } from '@filigran/ui';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { ThreatListSortKey } from '@app/module/client';
import { THREAT_ENTITY_TYPES, THREAT_SOURCE_KINDS } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { OpenctiBackfillIndicator } from '../../integrations';
import { THREAT_ANALYSES_LIST_SEARCH_DEFAULTS, threatAnalysesListSearchSchema } from '../threat-analyses-list-search';
import { usePersistedPageSize, usePersistedSorting, useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { useCounterparts, XtmRowMarks } from '../../xtm/xtm-counterparts';
import { resolveOptionFilter } from '../../../utils';
import { ListEmptyCard } from '../../../components/ui/list-empty-card';
import { ListNoResults } from '../../../components/ui/list-no-results';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { DebouncedSearchField } from '../../../components/shared';
import { ThreatCatalogKpiBand } from './threat-catalog-kpi-band';
import { ThreatListPage } from './threat-list-page';
import { ThreatListTable } from './threat-list-table';
import { isThreatCatalogEmpty, isThreatListFiltered, sourceKindLabel, THREAT_LIST_INITIAL_COLUMN_VISIBILITY } from './threat-list-utils';
import { threatEntityTypeLabel } from './threat-type-badge';
import { ThreatUploadButton } from './threat-upload-button';

const PAGE_LIMIT = 50;

// Column order/visibility, page size, view and sort all stay shared across both modes:
// switching outcome filters is not supposed to reset the table layout the user picked.
const STORAGE_KEY = 'threatList';

/**
 * A column absent from here must declare `enableSorting: false`, or it offers an ordering the
 * server cannot answer. `satisfies` ties every value to the server's own `ThreatListSortKey`
 * union, so a typo or a key the server drops fails to compile instead of silently going unsorted.
 */
const SORT_KEY_BY_COLUMN = {
  name: 'name',
  topOutcome: 'outcomeScore',
  cveCount: 'cveCount',
  techniqueCount: 'techniqueCount',
  activity: 'lastObservedAt',
  stixCreated: 'stixCreated',
  updatedAt: 'updatedAt',
} as const satisfies Record<string, ThreatListSortKey>;

// Widened for the lookup below: indexing with an arbitrary column id must read as "maybe absent"
// rather than narrowing the id itself, which `SORT_KEY_BY_COLUMN`'s literal key type cannot do
// without an unsafe assertion.
const SORT_KEY_LOOKUP: Record<string, ThreatListSortKey | undefined> = SORT_KEY_BY_COLUMN;

const DEFAULT_SORTING = [{ id: 'topOutcome', desc: true }];

const toSortKey = (columnId: string | undefined): ThreatListSortKey | undefined =>
  (columnId === undefined ? undefined : SORT_KEY_LOOKUP[columnId]);

export const ThreatAnalysesDataTable: FunctionComponent = () => {
  const trpc = useTRPC();
  const [page, setPage] = useState(1);
  const { filters, setFilters } = useUrlListFilters(threatAnalysesListSearchSchema);

  const { data: outcomes } = useQuery(trpc.attackOutcomes.getAttackOutcomes.queryOptions());
  // `outcomes` is `undefined` while the catalogue query is pending, not because the tenant has no
  // outcomes: a deep link or a copied cross-tenant address can carry an `outcomeId` this tenant
  // resolves nothing for, and only a loaded catalogue can tell the two apart.
  const outcomeIds = outcomes === undefined ? undefined : outcomes.map((outcome) => outcome.id);
  const resolvedOutcomeId = resolveOptionFilter(filters.outcomeId, outcomeIds, 'all');
  const outcomeId = resolvedOutcomeId === 'all' ? undefined : resolvedOutcomeId;
  const entityType = filters.entityType === 'all' ? undefined : filters.entityType;
  const kind = filters.kind === 'all' ? undefined : filters.kind;

  // Page 3 of the old filter is a slice of a list that no longer exists. Adjusted during render
  // (React's own pattern for resetting state on a prop/derived-value change) rather than in an
  // effect, which would commit the stale page first and only correct it a render later.
  const [seenFilters, setSeenFilters] = useState({ outcomeId, entityType, kind, search: filters.search });
  if (seenFilters.outcomeId !== outcomeId || seenFilters.entityType !== entityType || seenFilters.kind !== kind || seenFilters.search !== filters.search) {
    setSeenFilters({ outcomeId, entityType, kind, search: filters.search });
    setPage(1);
  }

  const { pageSize } = usePersistedPageSize(STORAGE_KEY, PAGE_LIMIT);
  const { sorting } = usePersistedSorting(STORAGE_KEY, DEFAULT_SORTING);
  const [activeSort] = sorting;
  const sortBy = toSortKey(activeSort?.id);
  const sortDesc = activeSort?.desc ?? true;

  const { data, isLoading, isPlaceholderData, isFetching } = useQuery(trpc.threats.list.queryOptions(
    { page, limit: pageSize, sortBy, sortDesc, outcomeId, entityType, kind, search: filters.search.trim() || undefined },
    { placeholderData: keepPreviousData },
  ));
  const pending = data?.pending ?? 0;
  // The same threats in OpenCTI and OpenAEV, by STIX id: one batched lookup per page, nothing while not connected.
  const counterparts = useCounterparts('THREAT', (data?.items ?? []).map((item) => item.stixId));

  const { toast } = useToast();
  const deleteImported = useMutation(trpc.threats.deleteImported.mutationOptions({ meta: { skipSuccessToast: true } }));

  const deletable = kind === 'stix-import';
  const filtered = isThreatListFiltered({ search: filters.search, outcomeId, entityType, kind });

  const emptyCard = (
    <ListEmptyCard
      title={<Trans>Start with the threats</Trans>}
      body={(
        <Trans>
          A threat is an intrusion set, a threat actor or a campaign whose operations are read against your
          attack outcomes: what it goes after and which techniques it uses are what make a scenario
          plausible. Upload a STIX bundle, or connect an integration that keeps them current.
        </Trans>
      )}
      actions={(
        <>
          <ThreatUploadButton />
          <Button priority="secondary" asChild>
            <Link from="/$tenantId/{-$organizationId}" to="/$tenantId/{-$organizationId}/integrations/available">
              <Trans>Connect an integration</Trans>
            </Link>
          </Button>
        </>
      )}
    />
  );

  const noResults = filtered ? <ListNoResults onClearFilters={() => setFilters(THREAT_ANALYSES_LIST_SEARCH_DEFAULTS)} /> : undefined;

  const table = (
    <ThreatListTable
      // The table reads its selection options only when it mounts, so turning deletion on or off remounts it.
      key={deletable ? 'deletable' : 'read-only'}
      data={data?.items ?? []}
      total={data?.total ?? 0}
      isLoading={isLoading}
      isPlaceholderData={isPlaceholderData}
      isFetching={isFetching}
      storageKey={STORAGE_KEY}
      catalog
      initialColumnVisibility={THREAT_LIST_INITIAL_COLUMN_VISIBILITY}
      renderRowMarks={(row) => (
        <XtmRowMarks counterparts={counterparts.filter((c) => c.key === row.stixId.toLowerCase())} />
      )}
      initialPageSize={PAGE_LIMIT}
      pageIndex={page - 1}
      serverSorted
      onServerPageChange={(pagination) => setPage(pagination.pageIndex + 1)}
      // Offered only when every row is an import: a connector's threat would come back from its feed.
      onDeleteItems={deletable
        ? async (ids) => {
          const { deleted } = await deleteImported.mutateAsync(ids);
          const kept = ids.length - deleted;
          if (kept === 0) {
            toast({ description: t`Threats deleted successfully.` });
            return;
          }
          toast({
            description: plural(kept, {
              one: '# threat was not deleted: it is no longer an import, or it was already removed.',
              other: '# threats were not deleted: they are no longer imports, or were already removed.',
            }),
            variant: 'destructive',
          });
        }
        : undefined}
      emptyState={noResults}
      showOutcomeColumn
      outcomeColumnHeader={outcomeId ? t`Probability` : undefined}
      initialSorting={DEFAULT_SORTING}
      leftHeaderContent={(
        <div className="flex flex-wrap items-center gap-3">
          <DebouncedSearchField
            placeholder={t`Search threats...`}
            value={filters.search}
            onCommit={(search) => setFilters({ search })}
            clearLabel={t`Clear search`}
            className="w-64"
          />
          <Select value={resolvedOutcomeId} onValueChange={(value) => setFilters({ outcomeId: value })}>
            <SelectTrigger className="w-56" aria-label={t`Filter by outcome`}>
              <SelectValue placeholder={t`Filter by outcome`} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all"><Trans>All outcomes</Trans></SelectItem>
              {(outcomes ?? []).map((outcome) => (
                <SelectItem key={outcome.id} value={outcome.id}>{outcome.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.entityType} onValueChange={(value) => setFilters({ entityType: threatAnalysesListSearchSchema.shape.entityType.parse(value) })}>
            <SelectTrigger className="w-44" aria-label={t`Filter by type`}>
              <SelectValue placeholder={t`Filter by type`} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all"><Trans>All types</Trans></SelectItem>
              {THREAT_ENTITY_TYPES.map((type) => (
                <SelectItem key={type} value={type}>{threatEntityTypeLabel(type)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.kind} onValueChange={(value) => setFilters({ kind: threatAnalysesListSearchSchema.shape.kind.parse(value) })}>
            <SelectTrigger className="w-44" aria-label={t`Filter by source`}>
              <SelectValue placeholder={t`Filter by source`} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all"><Trans>All sources</Trans></SelectItem>
              {THREAT_SOURCE_KINDS.map((sourceKind) => (
                <SelectItem key={sourceKind} value={sourceKind}>{sourceKindLabel(sourceKind)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    />
  );

  return (
    <ThreatListPage
      pending={pending}
      catalogEmpty={isThreatCatalogEmpty({ total: data?.total, filtered, isPlaceholderData })}
      emptyState={emptyCard}
      kpiBand={<ThreatCatalogKpiBand />}
      uploadAction={<ThreatUploadButton />}
      backfillStatus={<OpenctiBackfillIndicator />}
    >
      {table}
    </ThreatListPage>
  );
};
