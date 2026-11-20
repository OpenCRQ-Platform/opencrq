import { Sheet, SheetTrigger } from '@filigran/ui';
import type { ComponentPropsWithRef, FunctionComponent, ReactNode } from 'react';
import { DrawerFormHeader } from './drawer-form-header';
import { DrawerContent } from './drawer-content';
import { useDrawerOpenState } from './use-drawer-open-state';

interface DisplayDrawerProps {
  title?: ReactNode,
  category?: ReactNode,
  children: ReactNode,
  open?: boolean,
  onClose?: () => void,
  trigger?: ReactNode,
  className?: string,
  onOpenAutoFocus?: ComponentPropsWithRef<typeof DrawerContent>['onOpenAutoFocus'],
  onCloseAutoFocus?: ComponentPropsWithRef<typeof DrawerContent>['onCloseAutoFocus'],
  /** Points the dialog's accessible name at a heading rendered in `children`, when `title` alone does not carry it. */
  ariaLabelledBy?: string,
}

export const DisplayDrawer: FunctionComponent<DisplayDrawerProps> = ({
  open,
  trigger,
  title,
  category,
  children,
  onClose,
  className,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ariaLabelledBy,
}) => {
  const { currentOpen, handleOpenChange } = useDrawerOpenState({ open, onClose });

  return (
    <Sheet open={currentOpen} onOpenChange={handleOpenChange}>
      {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
      <DrawerContent className={className} onOpenAutoFocus={onOpenAutoFocus} onCloseAutoFocus={onCloseAutoFocus} aria-labelledby={ariaLabelledBy}>
        {(category || title) && <DrawerFormHeader category={category} title={title} />}
        {children}
      </DrawerContent>
    </Sheet>
  );
};
