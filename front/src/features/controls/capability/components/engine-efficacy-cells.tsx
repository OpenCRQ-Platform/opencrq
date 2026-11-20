import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { TriangleAlert } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import type { ColumnDefWithOptionsHeader } from '../../../../components/ui/data-table-types';
import type { CoveredTechniqueTestReading, TechniqueTestReading } from '../types/validation';
import { EmptyValue } from '../../../../components/ui/empty-value';
import { feedbackFigureColor } from '../../../finding-score';
import { efficacyVerdict, formatEnginePercent } from '../utils/engine-efficacy-utils';
import { hostResultText, testResultText } from '../ui/test-result-text';

/** The figure in the warning tone where the tests pulled the declaration down. */
export const efficacyFigureColor = (reading: Pick<CoveredTechniqueTestReading, 'tested' | 'declared' | 'efficacy'>): string | undefined =>
  (efficacyVerdict(reading) === 'lowered' ? feedbackFigureColor('warning') : undefined);

/** What OpenAEV observed of a control on a technique and function: its tests, then the hosts they ran on. */
export const OpenAevResult: FunctionComponent<{ reading: TechniqueTestReading | undefined }> = ({ reading }) => {
  if (reading === undefined) {
    return <EmptyValue />;
  }
  if (reading.tested === null) {
    return <span className="text-default-secondary"><Trans>Not tested</Trans></span>;
  }
  return (
    <span className="flex flex-col">
      <span>{testResultText(reading.function, reading.tested)}</span>
      <span className="txt-sub-content text-default-secondary">{hostResultText(reading.tested)}</span>
    </span>
  );
};

/** OpenAEV tested the control on a technique no active link ties it to, which an uncovered reading alone does not say. */
export const isTestedNotDeclared = (reading: TechniqueTestReading, isUnlinked: boolean): boolean =>
  !reading.covered && reading.tested !== null && isUnlinked;

/**
 * The engine efficacy, the declaration under it; "Not covered" where the control does not cover the
 * technique, a warning where it is not linked to it and OpenAEV tested it there all the same.
 */
export const EngineEfficacyFigure: FunctionComponent<{
  reading: TechniqueTestReading,
  isUnlinked: boolean,
}> = ({ reading, isUnlinked }) => {
  if (isTestedNotDeclared(reading, isUnlinked)) {
    return (
      <Chip
        severity="high"
        startIcon={<TriangleAlert aria-hidden="true" className="size-3.5" />}
        label={t({ message: 'Not declared', context: 'engine efficacy' })}
      />
    );
  }
  if (!reading.covered) {
    return <span className="text-default-secondary"><Trans context="engine efficacy">Not covered</Trans></span>;
  }
  const declared = formatEnginePercent(reading.declared);
  const color = efficacyFigureColor(reading);
  return (
    <span className="flex flex-col">
      <span className="font-medium" style={color === undefined ? undefined : { color }}>{formatEnginePercent(reading.efficacy)}</span>
      <span className="txt-sub-content text-default-secondary"><Trans>Declared {declared}</Trans></span>
    </span>
  );
};

/** The id of the efficacy's figure column, which the "i" column beside it is shown with. */
export const ENGINE_EFFICACY_COLUMN_ID = 'engineEfficacy';

/** Its widest content, the "Not declared" chip, and its padding: any wider pushes the "i" away from the figure. */
export const ENGINE_EFFICACY_COLUMN_SIZE = 160;

/**
 * The column holding the efficacy's "i", right after the figure's: one column of its own puts every "i"
 * on the same vertical, whatever each figure's width in the reader's language. It stays out of the
 * columns menu and empties when the reader hides the figure, which it explains.
 */
export const efficacyExplanationColumn = <T extends object>(cell: (row: T) => ReactNode): ColumnDefWithOptionsHeader<T, unknown> => ({
  id: 'engineEfficacyExplanation',
  header: ({ table }) => (table.getColumn(ENGINE_EFFICACY_COLUMN_ID)?.getIsVisible() === false
    ? null
    : <span className="sr-only">{t`How the engine efficacy is computed`}</span>),
  optionsHeader: () => null,
  size: 56,
  enableSorting: false,
  enableHiding: false,
  enableResizing: false,
  cell: ({ row, table }) => (table.getColumn(ENGINE_EFFICACY_COLUMN_ID)?.getIsVisible() === false ? null : cell(row.original)),
});

/**
 * The sizing of a table's last column: no width of its own (the table reads -1 as none), so it takes the
 * room the table has to spare, rather than every column sharing it and pushing the efficacy's "i" away
 * from its figure.
 */
export const FILLS_SPARE_WIDTH = { size: -1, minSize: -1 } as const;
