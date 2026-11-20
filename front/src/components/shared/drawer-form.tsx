import type { ReactNode } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { DrawerFormBody } from './drawer-form-body';
import { DrawerFormColumn } from './drawer-form-column';
import { useFormDrawerDirtyCheck } from './form-drawer';

interface DrawerFormProps<T extends FieldValues> {
  form: UseFormReturn<T>,
  onSubmit: (values: T) => void,
  className?: string,
  children: ReactNode,
  /** Rendered below the scrolling body, so it stays in view whatever the body holds. */
  footer?: ReactNode,
}

export const DrawerForm = <T extends FieldValues>({
  form,
  onSubmit,
  className,
  children,
  footer,
}: DrawerFormProps<T>) => {
  useFormDrawerDirtyCheck(form);

  return (
    <DrawerFormColumn onSubmit={form.handleSubmit(onSubmit)} className={className}>
      <DrawerFormBody>{children}</DrawerFormBody>
      {footer}
    </DrawerFormColumn>
  );
};
