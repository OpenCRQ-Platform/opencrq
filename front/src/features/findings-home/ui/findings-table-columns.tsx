import { Chip } from '@filigran/design-system';
import type { ReactElement } from 'react';
import { plural, t } from '@lingui/core/macro';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { FindingKind, FindingTableRow } from '../findings-table-utils';
import { EmptyValue } from '../../../components/ui/empty-value';
import { SourceStack } from '../../../components/shared';
import { AssetName } from '../../../components/shared/asset-name';
import { EvidenceStateChip } from '../../finding-detail';
import { ScoreGaugeMark, severityBandLabel, UnscoredMark } from '../../finding-score';
import { formatDate, getAssetCategoryLabel } from '../../../utils';
import { assetNameText } from '../../../utils/asset-name-utils';

const findingKindLabel = (kind: FindingKind): string => {
  switch (kind) {
    case 'vulnerability': return t`Vulnerability`;
    case 'detection_response': return t`Control Response: Detection`;
    case 'prevention_response': return t`Control Response: Prevention`;
    case 'control_response': return t`Control Response`;
  }
};

interface FindingsTableColumnsOptions {
  /** The state column only earns its width when the filter lets a dismissed finding through, whose chip names what dismissed it. */
  showState: boolean,
  /** Off on a single asset's own list, where every row would repeat the page's asset. */
  showAsset: boolean,
}

export const findingsTableColumns = <T extends FindingTableRow>(
  { showState, showAsset }: FindingsTableColumnsOptions,
): Array<ColumnDefWithOptionsHeader<T, unknown>> => {
  const stateColumns: Array<ColumnDefWithOptionsHeader<T, unknown>> = showState
    ? [{
      id: 'currentState',
      accessorFn: (row) => row.currentState,
      header: t`State`,
      size: 170,
      cell: ({ row }): ReactElement => (
        <EvidenceStateChip
          state={row.original.currentState}
          kind={row.original.kind === 'vulnerability' ? 'cve' : 'technique'}
          origin={row.original.stateOrigin}
          dismissalType={row.original.dismissalType}
        />
      ),
    }]
    : [];

  const assetColumns: Array<ColumnDefWithOptionsHeader<T, unknown>> = showAsset
    ? [
      {
        id: 'assetName',
        accessorFn: (row) => assetNameText({ name: row.assetName, derivedName: row.assetDerivedName }, t`Unnamed asset`),
        header: t`Asset`,
        size: 220,
        cell: ({ row }): ReactElement => (
          <AssetName name={row.original.assetName} derivedName={row.original.assetDerivedName} className="font-medium truncate" />
        ),
      },
      {
        id: 'assetCategoryId',
        accessorFn: (row) => row.assetCategoryId,
        header: t`Asset type`,
        size: 150,
        cell: ({ row }): ReactElement => (
          row.original.assetCategoryId === null
            ? <EmptyValue />
            : <Chip label={getAssetCategoryLabel(row.original.assetCategoryId)} />
        ),
      },
    ]
    : [];

  return [
    {
      id: 'name',
      accessorFn: (row) => row.name,
      header: t`Finding`,
      size: 280,
      cell: ({ row }): ReactElement => (
        row.original.name === ''
          ? <EmptyValue />
          : (
            <span className="flex items-baseline gap-2 min-w-0">
              <span className="font-mono font-medium shrink-0">{row.original.name}</span>
              {row.original.detail && (
                <span className="txt-sub-content text-muted-foreground truncate">{row.original.detail}</span>
              )}
            </span>
          )
      ),
    },
    {
      id: 'kind',
      accessorFn: (row) => findingKindLabel(row.kind),
      header: t`Type`,
      size: 200,
      cell: ({ row }): ReactElement => (
        <Chip label={findingKindLabel(row.original.kind)} />
      ),
    },
    ...stateColumns,
    {
      id: 'score',
      accessorFn: (row) => row.score ?? undefined,
      sortUndefined: 'last',
      header: t`Score`,
      size: 90,
      cell: ({ row }): ReactElement => {
        const { score, band, pendingVector, nvdRecordMissing } = row.original;
        if (pendingVector) {
          return <UnscoredMark nvdRecordMissing={nvdRecordMissing} />;
        }
        if (score === null || band === null) {
          return <EmptyValue />;
        }
        const bandWord = severityBandLabel(band);
        return (
          <ScoreGaugeMark
            score={score}
            band={band}
            label={t`Finding score: ${score} out of 100, ${bandWord} band`}
          />
        );
      },
    },
    ...assetColumns,
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
      size: 140,
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
      size: 120,
      cell: ({ row }): ReactElement => {
        const days = row.original.ageDays;
        if (days === null) {
          return <EmptyValue />;
        }
        return (
          <span className="text-muted-foreground">
            {plural(days, { one: '# day', other: '# days' })}
          </span>
        );
      },
    },
  ];
};
