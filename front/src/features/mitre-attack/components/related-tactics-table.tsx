import { t } from '@lingui/core/macro';
import { useNavigate } from '@tanstack/react-router';
import type { FunctionComponent, ReactElement } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { DataPageLayout } from '../../../components/ui/data-page-layout';

interface RelatedTactic {
  id: string,
  externalId: string,
  name: string,
}

interface RelatedTacticsTableProps {
  tactics: Array<RelatedTactic>,
  storageKey: string,
  emptyState: ReactElement,
  /**
   * Column widths for a card holding a third of the page. Sizes are minimums the table widens
   * proportionally, so the full-width set overflows a narrow card into a horizontal scrollbar.
   */
  compact?: boolean,
}

export const RelatedTacticsTable: FunctionComponent<RelatedTacticsTableProps> = ({
  tactics,
  storageKey,
  emptyState,
  compact,
}) => {
  const navigate = useNavigate();

  const columns: Array<ColumnDefWithOptionsHeader<RelatedTactic, unknown>> = [
    {
      id: 'externalId',
      accessorKey: 'externalId',
      header: t`ID`,
      size: compact === true ? 110 : 140,
      cell: ({ row }): ReactElement => (
        <span className="font-mono txt-sub-content text-muted-foreground">{row.original.externalId}</span>
      ),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: compact === true ? 220 : 800,
      cell: ({ row }): ReactElement => <span>{row.original.name}</span>,
    },
  ];

  return (
    <DataPageLayout
      data={tactics}
      columns={columns}
      storageKey={storageKey}
      hideToolbar
      initialSorting={[{ id: 'externalId', desc: false }]}
      emptyState={emptyState}
      onClickRow={(row) => void navigate({
        from: '/$tenantId/{-$organizationId}',
        to: 'settings/taxonomies/mitre-attack/tactics/$tacticExternalId',
        params: { tacticExternalId: row.original.externalId },
      })}
    />
  );
};
