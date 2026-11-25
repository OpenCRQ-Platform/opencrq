import { Chip } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import type { ReactElement, ReactNode } from 'react';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { UniqueFindingTableRow } from '../unique-findings-table-utils';
import { EmptyValue } from '../../../components/ui/empty-value';
import { InfoTooltip, SourceStack } from '../../../components/shared';
import { ScoreGaugeMark, severityBandFigureColor, severityBandLabel, UnscoredMark } from '../../finding-score';
import { getExpectationTypeLabel } from '../../../utils';
import { formatNumber } from '../../../utils/format-number';

const VulnerabilityCell = ({ row, marks }: { row: UniqueFindingTableRow, marks?: ReactNode }): ReactElement => {
  if (row.name === '') {
    return <EmptyValue />;
  }
  if (row.isTechnique) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-mono font-medium">{row.name}</span>
        {row.detail !== null && <span className="truncate font-medium">{row.detail}</span>}
        {row.expectationType !== null && <Chip label={getExpectationTypeLabel(row.expectationType)} />}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex items-center gap-1.5">
        <span className="font-mono font-medium">{row.name}</span>
        {marks}
      </span>
      {row.detail !== null && <span className="txt-sub-content truncate text-muted-foreground">{row.detail}</span>}
    </span>
  );
};

const ScoreHeader = (): ReactElement => (
  <span className="flex items-center gap-1.5">
    {t`Score`}
    {/* The header sorts on click: the tooltip's own click must not reach it. */}
    <span onClick={(event) => event.stopPropagation()}>
      <InfoTooltip label={t`About the score`} side="bottom">
        <span>
          <Trans>The worst finding's score, raised when the vulnerability reaches other assets at a close level. Capped at 100.</Trans>
        </span>
        <span className="text-muted-foreground">
          <Trans>A worst finding at 85 on 1,000 assets gives 91, in the critical band.</Trans>
        </span>
      </InfoTooltip>
    </span>
  </span>
);

/**
 * `renderRowMarks` adds marks beside a CVE's identifier (the OpenCTI / OpenAEV counterparts of the
 * vulnerability); a technique row never carries any.
 */
export const uniqueFindingsTableColumns = <T extends UniqueFindingTableRow = UniqueFindingTableRow>(
  renderRowMarks?: (row: T) => ReactNode,
): Array<ColumnDefWithOptionsHeader<T, unknown>> => [
  {
    id: 'name',
    accessorFn: (row) => row.name,
    header: t`Vulnerability`,
    size: 280,
    cell: ({ row }): ReactElement => <VulnerabilityCell row={row.original} marks={row.original.isTechnique ? undefined : renderRowMarks?.(row.original)} />,
  },
  {
    id: 'score',
    accessorFn: (row) => row.score ?? undefined,
    sortUndefined: 'last',
    header: (): ReactElement => <ScoreHeader />,
    size: 160,
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
        <span className="flex items-center gap-2">
          <ScoreGaugeMark score={score} band={band} label={i18n._({ id: 'Unique finding score: {score} out of 100, {bandWord} band', message: 'Unique finding score: {score} out of 100, {bandWord} band', values: { score, bandWord } })} />
          <Chip severity={band} label={bandWord} />
        </span>
      );
    },
  },
  {
    id: 'worstScore',
    accessorFn: (row) => row.worstScore ?? undefined,
    enableSorting: false,
    header: t`Worst finding`,
    size: 130,
    cell: ({ row }): ReactElement => {
      const { worstScore, worstBand } = row.original;
      if (worstScore === null || worstBand === null) {
        return <EmptyValue />;
      }
      return (
        <span className="flex items-baseline gap-1.5">
          <span className="font-medium tabular-nums" style={{ color: severityBandFigureColor(worstBand) }}>{worstScore}</span>
          <span className="txt-sub-content text-muted-foreground">{severityBandLabel(worstBand)}</span>
        </span>
      );
    },
  },
  {
    id: 'affectedAssets',
    accessorFn: (row) => row.affectedAssetCount,
    header: t`Affected assets`,
    size: 130,
    cell: ({ row }): ReactElement => (
      <span className="tabular-nums">{formatNumber(row.original.affectedAssetCount)}</span>
    ),
  },
  {
    id: 'threat',
    accessorFn: (row) => row.epssPercent,
    enableSorting: false,
    header: t`KEV / EPSS`,
    // Wide enough for the longest known-exploited label, the French one, beside its EPSS figure.
    size: 280,
    cell: ({ row }): ReactElement => {
      const { knownExploited, epssPercent } = row.original;
      if (knownExploited !== true && epssPercent === null) {
        return <EmptyValue />;
      }
      return (
        <span className="flex items-center gap-2">
          {knownExploited === true && <Chip severity="critical" label={t`Known exploited`} />}
          {epssPercent !== null && (
            <span className="whitespace-nowrap tabular-nums text-muted-foreground">
              <Trans>EPSS {epssPercent}%</Trans>
            </span>
          )}
        </span>
      );
    },
  },
  {
    id: 'connectorSource',
    accessorFn: (row) => row.sources.join(','),
    enableSorting: false,
    header: t`Sources`,
    size: 100,
    cell: ({ row }): ReactElement => <SourceStack sources={row.original.sources} />,
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
