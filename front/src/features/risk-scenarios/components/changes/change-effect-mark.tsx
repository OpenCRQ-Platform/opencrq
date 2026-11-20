import type { ChangeDirection } from '@app/module/client';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { cn } from '../../../../utils';

const MARK: Record<ChangeDirection, { symbol: string, className: string, label: () => string }> = {
  up: { symbol: '↑', className: 'bg-feedback-error-secondary-transparency-30 text-feedback-error-primary', label: () => t`Raises the loss` },
  down: { symbol: '↓', className: 'bg-feedback-success-secondary-transparency-30 text-feedback-success-primary', label: () => t`Lowers the loss` },
  none: { symbol: '·', className: 'bg-feedback-neutral-secondary-transparency-30 text-muted-foreground', label: () => t`Moves no risk` },
};

export const EffectMark: FunctionComponent<{ direction: ChangeDirection }> = ({ direction }) => {
  const mark = MARK[direction];
  return (
    <span
      role="img"
      aria-label={mark.label()}
      className={cn('inline-flex size-5.5 shrink-0 items-center justify-center rounded-full txt-sub-content', mark.className)}
    >
      {mark.symbol}
    </span>
  );
};
