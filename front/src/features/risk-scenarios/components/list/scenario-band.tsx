import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { cn } from '../../../../utils';

interface ScenarioBandProps {
  p10: number | null,
  p90: number | null,
  format: (value: number) => string,
  className?: string,
}

/** A run older than the p10 and p90 columns carries no band until its scenario runs again. */
export const ScenarioBand: FunctionComponent<ScenarioBandProps> = ({ p10, p90, format, className }) => {
  const classes = cn('txt-sub-content text-muted-foreground tabular-nums whitespace-nowrap', className);
  if (p10 === null || p90 === null) {
    return <span className={classes}><Trans>Band not computed</Trans></span>;
  }
  const low = format(p10);
  const high = format(p90);
  return <span className={classes}><Trans>p10 {low} - p90 {high}</Trans></span>;
};
