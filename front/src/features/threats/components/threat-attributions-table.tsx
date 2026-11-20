import type { ThreatEntityType } from '@app/module/client';
import { includesFolded } from '@app/utils/text-fold';
import { Chip } from '@filigran/design-system';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { Link, useNavigate } from '@tanstack/react-router';
import { List, Network } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import { useState } from 'react';
import type { IconButtonGroupItem } from '../../../components/ui/icon-button-group';
import type { AttributionReference, AttributionRelation, AttributionRow } from './threat-overview-utils';
import { DebouncedSearchField, SectionCard } from '../../../components/shared';
import { DataPageLayout } from '../../../components/ui/data-page-layout';
import { DataPageToolbar } from '../../../components/ui/data-page-toolbar';
import { IconButtonGroup } from '../../../components/ui/icon-button-group';
import { usePersistedView } from '../../../hooks';
import { buildAttributionRows } from './threat-overview-utils';
import { ThreatAttributionGraph } from './threat-attribution-graph';
import { threatEntityTypeLabel } from './threat-type-badge';
import { ThreatTypeIcon } from './threat-type-icon';

const PAGE_SIZE = 20;
const STORAGE_KEY = 'threat-overview-attributions';
const NOTHING_EXPANDED: ReadonlySet<ThreatEntityType> = new Set();

type AttributionView = 'list' | 'graph';

const relationLabel = (relation: AttributionRelation): string => {
  switch (relation) {
    case 'attributed-to':
      return t`Attributed to`;
    case 'attributed-from':
      return t`Attributed to this threat`;
  }
};

interface ThreatAttributionsTableProps {
  threat: AttributionReference,
  attributedTo: ReadonlyArray<AttributionReference>,
  attributedFrom: ReadonlyArray<AttributionReference>,
}

export const ThreatAttributionsTable: FunctionComponent<ThreatAttributionsTableProps> = ({ threat, attributedTo, attributedFrom }) => {
  const navigate = useNavigate();
  const { view: chosenView, setView } = usePersistedView<AttributionView>(STORAGE_KEY, 'list', ['list', 'graph']);
  const [search, setSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  /** Keyed by the threat, since the card stays mounted when the page moves to another one. */
  const [expansion, setExpansion] = useState<{ threatId: string, types: ReadonlySet<ThreatEntityType> }>({ threatId: threat.id, types: new Set() });
  const expanded = expansion.threatId === threat.id ? expansion.types : NOTHING_EXPANDED;
  const rows = buildAttributionRows(attributedTo, attributedFrom).filter((row) => includesFolded(row.name, search));
  const isEmpty = attributedTo.length === 0 && attributedFrom.length === 0;
  const view = isEmpty ? 'list' : chosenView;

  const viewItems: Array<IconButtonGroupItem<AttributionView>> = [
    { value: 'list', icon: <List className="size-4" />, tooltip: t`List view` },
    { value: 'graph', icon: <Network className="size-4" />, tooltip: t`Graph view` },
  ];
  const viewToggle = isEmpty ? undefined : <IconButtonGroup items={viewItems} value={view} onChange={setView} />;

  const columns: Array<ColumnDefWithOptionsHeader<AttributionRow, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      cell: ({ row }): ReactElement => (
        <span className="flex min-w-0 items-center gap-2">
          <ThreatTypeIcon entityType={row.original.entityType} />
          <Link
            from="/$tenantId/{-$organizationId}"
            to="threat-center/threats/$threatId"
            params={{ threatId: row.original.threatId }}
            onClick={(event) => event.stopPropagation()}
            title={row.original.name}
            className="truncate whitespace-nowrap font-medium hover:underline"
          >
            {row.original.name}
          </Link>
        </span>
      ),
    },
    {
      id: 'type',
      accessorFn: (row) => threatEntityTypeLabel(row.entityType),
      header: t`Type`,
      size: 150,
      cell: ({ row }): ReactElement => <Chip label={threatEntityTypeLabel(row.original.entityType)} />,
    },
    {
      id: 'relation',
      accessorFn: (row) => relationLabel(row.relation),
      header: t`Relation`,
      size: 200,
      cell: ({ row }): ReactElement => <span className="block truncate whitespace-nowrap">{relationLabel(row.original.relation)}</span>,
    },
  ];

  if (view === 'graph') {
    const neighbourCount = new Set([...attributedTo, ...attributedFrom].map((other) => other.id).filter((id) => id !== threat.id)).size;
    return (
      <SectionCard title={t`Attributions`} className="h-full" cardClassName="flex-1 overflow-hidden p-[0px]" contentClassName="gap-0">
        <div className="px-3 py-2">
          <DataPageToolbar dataLength={neighbourCount} viewToggle={viewToggle} />
        </div>
        <ThreatAttributionGraph
          threat={threat}
          attributedTo={attributedTo}
          attributedFrom={attributedFrom}
          expanded={expanded}
          onExpand={(entityType) => setExpansion({ threatId: threat.id, types: new Set([...expanded, entityType]) })}
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard title={t`Attributions`} className="h-full" cardClassName="flex-1">
      <DataPageLayout
        data={rows}
        columns={columns}
        storageKey={STORAGE_KEY}
        initialPageSize={PAGE_SIZE}
        pageIndex={pageIndex}
        onServerPageChange={(pagination) => setPageIndex(pagination.pageIndex)}
        viewToggle={viewToggle}
        leftHeaderContent={(
          <DebouncedSearchField
            value={search}
            onCommit={(next) => {
              setSearch(next);
              setPageIndex(0);
            }}
            clearLabel={t`Clear the search`}
            aria-label={t`Search for a threat`}
            placeholder={t`Search for a threat`}
            className="w-64"
          />
        )}
        emptyState={(
          <p className="txt-sub-content text-muted-foreground">
            {isEmpty ? t`No known threat is attributed to it, nor is it attributed to one.` : t`No threat matches this search.`}
          </p>
        )}
        onClickRow={(row) => {
          void navigate({
            from: '/$tenantId/{-$organizationId}',
            to: 'threat-center/threats/$threatId',
            params: { threatId: row.original.threatId },
          });
        }}
      />
    </SectionCard>
  );
};
