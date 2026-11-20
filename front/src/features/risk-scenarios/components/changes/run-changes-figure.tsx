import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';
import { TooltipHint } from '../../../../components/shared';
import { cn } from '../../../../utils';
import { EMPTY_VALUE } from '../../../../utils/empty-value';

/** A run's figure within a line, whose empty value says why in a tooltip and to a screen reader. */
export const RunValue: FunctionComponent<{ value: string | null }> = ({ value }) => (value === null
  ? (
    <TooltipHint hint={<Trans>No value on this run</Trans>}>
      <span>
        <span aria-hidden>{EMPTY_VALUE}</span>
        <span className="sr-only"><Trans>No value on this run</Trans></span>
      </span>
    </TooltipHint>
  )
  : value);

interface RunFigureProps {
  label: ReactNode,
  value: string | null,
  date: string,
  muted: boolean,
  chip?: ReactNode,
}

/** One side of the compared pair in the page header, its empty value explained under it. */
export const RunFigure: FunctionComponent<RunFigureProps> = ({ label, value, date, muted, chip }) => (
  <div className="flex flex-col gap-1">
    <span className="txt-sub-content text-muted-foreground">{label}</span>
    <div className="flex items-center gap-3">
      <span className={cn('txt-title font-bold', muted && 'text-muted-foreground')}>{value ?? EMPTY_VALUE}</span>
      {chip}
    </div>
    {value === null && <span className="txt-sub-content text-muted-foreground"><Trans>No value on this run</Trans></span>}
    <span className="txt-sub-content text-muted-foreground"><Trans>Run of {date}</Trans></span>
  </div>
);
