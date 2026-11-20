import { Chip } from '@filigran/design-system';
import type { ReactElement } from 'react';
import { plural, t } from '@lingui/core/macro';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { UniqueTechniqueFindingAssetRow } from '../unique-technique-finding-assets-utils';
import { SourceStack } from '../../../components/shared';
import { AssetName } from '../../../components/shared/asset-name';
import { EmptyValue } from '../../../components/ui/empty-value';
import { EvidenceStateChip } from '../../finding-detail';
import { formatDate, getAssetCategoryLabel, getAssetCriticalityLabel, getEndpointPlatformLabel } from '../../../utils';
import { assetNameText } from '../../../utils/asset-name-utils';

type Column = ColumnDefWithOptionsHeader<UniqueTechniqueFindingAssetRow, unknown>;

export const uniqueTechniqueFindingAssetsColumns = ({ showState }: { showState: boolean }): Array<Column> => {
  const stateColumns: Array<Column> = showState
    ? [{
      id: 'currentState',
      accessorFn: (row) => row.currentState,
      header: t`State`,
      size: 170,
      cell: ({ row }): ReactElement => (
        <EvidenceStateChip
          state={row.original.currentState}
          kind="technique"
          origin={row.original.stateOrigin}
          dismissalType={row.original.dismissalType}
        />
      ),
    }]
    : [];

  return [
    {
      id: 'assetName',
      accessorFn: (row) => assetNameText({ name: row.assetName, derivedName: row.assetDerivedName }, t`Unnamed asset`),
      header: t`Asset`,
      size: 240,
      cell: ({ row }): ReactElement => (
        <AssetName name={row.original.assetName} derivedName={row.original.assetDerivedName} className="font-medium truncate" />
      ),
    },
    ...stateColumns,
    {
      id: 'assetCategoryId',
      accessorFn: (row) => row.assetCategoryId,
      header: t`Asset type`,
      size: 140,
      cell: ({ row }): ReactElement => (
        row.original.assetCategoryId === null
          ? <EmptyValue />
          : <Chip label={getAssetCategoryLabel(row.original.assetCategoryId)} />
      ),
    },
    {
      id: 'assetCriticality',
      accessorFn: (row) => row.assetCriticality,
      enableSorting: false,
      header: t`Criticality`,
      size: 120,
      cell: ({ row }): ReactElement => <span>{getAssetCriticalityLabel(row.original.assetCriticality)}</span>,
    },
    {
      id: 'assetPlatforms',
      accessorFn: (row) => row.assetPlatforms.join(','),
      enableSorting: false,
      header: t`Platform`,
      size: 140,
      cell: ({ row }): ReactElement => (
        row.original.assetPlatforms.length === 0
          ? <EmptyValue />
          : (
            <span className="flex flex-wrap gap-1.5">
              {row.original.assetPlatforms.map((platform) => <Chip key={platform} label={getEndpointPlatformLabel(platform)} />)}
            </span>
          )
      ),
    },
    {
      id: 'connectorSource',
      accessorFn: (row) => row.sources.join(','),
      enableSorting: false,
      header: t`Source`,
      size: 100,
      cell: ({ row }): ReactElement => <SourceStack sources={row.original.sources} />,
    },
    {
      id: 'lastEvaluatedAt',
      accessorFn: (row) => row.lastEvaluatedAt,
      sortUndefined: 'last',
      header: t`Last seen`,
      size: 150,
      cell: ({ row }): ReactElement => (
        row.original.lastEvaluatedAt === null
          ? <EmptyValue />
          : <span className="text-muted-foreground">{formatDate(row.original.lastEvaluatedAt)}</span>
      ),
    },
    {
      id: 'ageDays',
      accessorFn: (row) => row.ageDays,
      sortUndefined: 'last',
      header: t`Age`,
      size: 110,
      cell: ({ row }): ReactElement => {
        const days = row.original.ageDays;
        if (days === null) {
          return <EmptyValue />;
        }
        return <span className="text-muted-foreground">{plural(days, { one: '# day', other: '# days' })}</span>;
      },
    },
  ];
};
