import type { ComponentPropsWithRef, FunctionComponent } from 'react';
import { cn } from '../../utils';

type DrawerFormBodyProps = ComponentPropsWithRef<'div'>;

/**
 * The part of a drawer form that scrolls, between the header and the footer. Bleeds over the sheet's
 * side padding so its scrollbar sits at the drawer's edge, and over its own vertical padding so a
 * focus ring on the first or last field is not clipped.
 */
export const DrawerFormBody: FunctionComponent<DrawerFormBodyProps> = ({
  className,
  ...props
}) => (
  <div
    className={cn('-mx-xl -my-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-xl py-1', className)}
    {...props}
  />
);
