import type { FunctionComponent } from 'react';
import { cn } from '../../utils';

interface WarningDotProps {
  /**
   * - `'inline'`   (default) — sits in the normal flow, `shrink-0`, for use inside flex rows
   * - `'absolute'` — overlaid on a `relative` parent at top-right corner
   */
  variant?: 'inline' | 'absolute',
}

export const WarningDot: FunctionComponent<WarningDotProps> = ({ variant: variantProp }) => {
  const variant = variantProp ?? 'inline';
  return (
    <span
      className={cn(
        'h-2 w-2 rounded-full bg-orange',
        variant === 'inline' ? 'shrink-0' : 'absolute top-1 right-1',
      )}
    />
  );
};
