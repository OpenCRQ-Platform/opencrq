import type { ColumnDefWithOptionsHeader } from '../../../../components/ui/data-table-types';
import { t } from '@lingui/core/macro';
import { COVERAGE_BUCKETS, STRENGTH_RUNGS } from '@app/module/client';
import type { MouseEvent } from 'react';
import { EllipsisVertical } from 'lucide-react';
import type { ListedCapability } from '../types/capability';
import { ControlIdPill } from '../../../../components/shared';
import { IconActions, IconActionsItem } from '../../../../components/shared/icon-actions';
import { formatDate } from '../../../../utils';
import { CoverageCell, EffectivenessCell, StrengthCell } from '../ui/capability-dimension-cells';
import { computeSoloEffectiveness } from '../utils/capability-effectiveness';

const rungOrder = <T extends string>(vocabulary: ReadonlyArray<T>, value: T | undefined): number | undefined =>
  (value === undefined ? undefined : vocabulary.indexOf(value));

export const useCapabilityColumns = (
  openDrawer: (capability: ListedCapability, e: MouseEvent) => void,
): Array<ColumnDefWithOptionsHeader<ListedCapability, unknown>> => [
  {
    id: 'externalId',
    accessorKey: 'externalId',
    header: t`ID`,
    size: 120,
    cell: ({ row }) => <ControlIdPill externalId={row.original.externalId} />,
  },
  {
    id: 'name',
    accessorKey: 'name',
    header: t`Name`,
    size: 350,
    cell: ({ row }) => (
      <p className="font-medium">{row.original.name}</p>
    ),
  },
  {
    id: 'strength',
    accessorFn: (row) => rungOrder(STRENGTH_RUNGS, row.assessment?.strengthRung),
    sortUndefined: 'last',
    header: t`Strength`,
    size: 140,
    cell: ({ row }) => <StrengthCell reading={row.original.assessment} />,
  },
  {
    id: 'coverage',
    accessorFn: (row) => rungOrder(COVERAGE_BUCKETS, row.assessment?.coverageBucket),
    sortUndefined: 'last',
    header: t`Coverage`,
    size: 140,
    cell: ({ row }) => <CoverageCell reading={row.original.assessment} />,
  },
  {
    id: 'effectiveness',
    accessorFn: (row) => (row.assessment === null ? undefined : computeSoloEffectiveness(row.assessment).score),
    sortUndefined: 'last',
    header: t`Effectiveness`,
    size: 150,
    cell: ({ row }) => <EffectivenessCell reading={row.original.assessment} />,
  },
  {
    id: 'lastAssessedAt',
    accessorFn: (row) => (row.lastAssessedAt === null ? undefined : new Date(row.lastAssessedAt).getTime()),
    sortUndefined: 'last',
    header: t`Last declared`,
    size: 140,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.lastAssessedAt === null ? t`Never` : formatDate(row.original.lastAssessedAt)}
      </span>
    ),
  },
  {
    id: 'actions',
    header: '',
    size: 60,
    enableSorting: false,
    cell: ({ row }) => (
      <span
        className="flex justify-end"
        data-row-action={row.original.id}
      >
        <IconActions icon={<EllipsisVertical className="h-4 w-4 text-primary" />}>
          <IconActionsItem onClick={(e) => openDrawer(row.original, e)}>
            {t`Edit`}
          </IconActionsItem>
        </IconActions>
      </span>
    ),
  },
];
