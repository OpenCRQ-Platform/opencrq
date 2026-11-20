import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { t } from '@lingui/core/macro';
import { useNavigate } from '@tanstack/react-router';
import type { DisplayCategory } from './technique-category';
import { TechniqueCategoryChip } from './technique-category-chip';

interface TechniqueLike {
  id: string,
  externalId: string,
  name: string,
}

export const createTechniqueColumn = <T extends TechniqueLike>(): ColumnDefWithOptionsHeader<T, unknown> => ({
  id: 'externalId',
  accessorKey: 'externalId',
  header: t`Technique`,
  cell: ({ row }) => (
    <span className="flex items-center gap-1.5">
      <span className="font-mono txt-sub-content text-muted-foreground">{row.original.externalId}</span>
      <span>{row.original.name}</span>
    </span>
  ),
});

export const createTechniqueCategoryColumn = <T extends { category: DisplayCategory }>(): ColumnDefWithOptionsHeader<T, unknown> => ({
  id: 'category',
  accessorKey: 'category',
  header: t`Category`,
  size: 120,
  cell: ({ row }) => <TechniqueCategoryChip category={row.original.category} />,
});

export const useTechniqueRowNavigate = <T extends { externalId: string }>() => {
  const navigate = useNavigate();
  return (row: { original: T }) => {
    void navigate({
      to: '/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId',
      params: (prev) => ({ tenantId: prev.tenantId!, techniqueExternalId: row.original.externalId }),
    });
  };
};
