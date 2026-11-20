import type { ComponentPropsWithRef, FunctionComponent } from 'react';
import { cn } from '../../utils';

type DrawerFormFooterProps = ComponentPropsWithRef<'div'>;

/**
 * The buttons of a drawer form, on the drawer header's background. The fill bleeds over the sheet's
 * side padding to reach both edges of the drawer.
 */
export const DrawerFormFooter: FunctionComponent<DrawerFormFooterProps> = ({
  className,
  ...props
}) => (
  <div
    className={cn(
      'flex shrink-0 flex-col-reverse gap-s -mx-xl bg-elevation-surface-heading-layer-2 px-xl py-3.5 sm:flex-row sm:justify-end',
      className,
    )}
    {...props}
  />
);
