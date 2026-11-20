import type { ComponentPropsWithRef, FunctionComponent } from 'react';
import { cn } from '../../utils';

type DrawerFormColumnProps = ComponentPropsWithRef<'form'>;

/**
 * The form of a drawer: a column that fills the sheet, so its body scrolls and its footer stays below.
 * Without `h-full` it grows with its content inside the sheet's own scroller. `noValidate` because
 * the design-system `required` prop sets the native attribute, whose bubble would fire before zod.
 */
export const DrawerFormColumn: FunctionComponent<DrawerFormColumnProps> = ({
  className,
  ...props
}) => (
  <form
    noValidate
    className={cn('flex h-full min-h-0 flex-col gap-4', className)}
    {...props}
  />
);
