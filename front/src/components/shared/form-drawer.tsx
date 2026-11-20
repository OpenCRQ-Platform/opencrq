import { Sheet, SheetTrigger } from '@filigran/ui';
import { useBlocker } from '@tanstack/react-router';
import type { FunctionComponent, ReactNode } from 'react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useFormState } from 'react-hook-form';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { DrawerFormHeader } from './drawer-form-header';
import { DrawerContent } from './drawer-content';
import { UnsavedChangesDialog } from './unsaved-changes-dialog';
import { useDrawerOpenState } from './use-drawer-open-state';

interface FormDrawerBaseProps {
  title: ReactNode,
  category?: ReactNode,
  children: ReactNode,
  onClose?: () => void,
  className?: string,
  onOpenAutoFocus?: (event: Event) => void,
}

interface FormDrawerControlledProps extends FormDrawerBaseProps {
  open: boolean,
  trigger?: ReactNode,
}

interface FormDrawerUncontrolledProps extends FormDrawerBaseProps {
  open?: never,
  trigger: ReactNode,
}

type FormDrawerProps = FormDrawerControlledProps | FormDrawerUncontrolledProps;

interface FormDrawerContextValue {
  registerDirtyCheck: (fn: () => boolean) => void,
  isDirty: () => boolean,
  confirmDiscard: (onDiscard: () => void, onCancel: () => void) => void,
  closeDrawer: () => void,
}

const FormDrawerContext = createContext<FormDrawerContextValue | undefined>(undefined);

export const useFormDrawerContext = () => {
  const context = useContext(FormDrawerContext);
  if (!context) {
    throw new Error('useFormDrawerContext must be used within a FormDrawer');
  }
  return { closeDrawer: context.closeDrawer };
};

/**
 * For a drawer whose fields span more than one form: the caller ORs the forms' own dirty flags.
 * Only one registration survives, so a surface calling this must not also call
 * `useFormDrawerDirtyCheck` or one of the two guards would be silently dropped.
 */
export const useFormDrawerDirtyState = (isDirty: boolean) => {
  const context = useContext(FormDrawerContext);
  if (!context) {
    throw new Error('useFormDrawerDirtyState must be used within a FormDrawer');
  }
  const { registerDirtyCheck } = context;

  useEffect(() => {
    registerDirtyCheck(() => isDirty);
    return () => registerDirtyCheck(() => false);
  }, [registerDirtyCheck, isDirty]);
};

export const useFormDrawerDirtyCheck = <T extends FieldValues>(form: UseFormReturn<T>) => {
  // Subscribe to isDirty so RHF actually computes it after value changes.
  // Without this, isDirty stays stale because RHF's Proxy skips unsubscribed state.
  const { isDirty } = useFormState({ control: form.control });
  useFormDrawerDirtyState(isDirty);
};

/**
 * For a drawer whose content links to another page: the drawer itself only guards its dismissal, so
 * a dirty form would otherwise be lost to a same-tab navigation. Holds every route change behind the
 * discard dialog while the form is dirty. Needs a router.
 */
export const useFormDrawerNavigationGuard = () => {
  const context = useContext(FormDrawerContext);
  if (!context) {
    throw new Error('useFormDrawerNavigationGuard must be used within a FormDrawer');
  }
  const { isDirty, confirmDiscard } = context;

  useBlocker({
    shouldBlockFn: () => isDirty() && new Promise<boolean>((resolve) => {
      confirmDiscard(() => resolve(false), () => resolve(true));
    }),
    enableBeforeUnload: isDirty,
  });
};

export const FormDrawer: FunctionComponent<
  FormDrawerProps
> = ({
  open: openProp,
  trigger,
  title,
  category,
  children,
  onClose,
  className,
  onOpenAutoFocus,
}) => {
  const { currentOpen, handleOpenChange: baseHandleOpenChange, requestClose } = useDrawerOpenState({ open: openProp, onClose });

  const [showDialog, setShowDialog] = useState(false);
  const dirtyCheckRef = useRef<() => boolean>(() => false);
  const showDialogRef = useRef(false);
  const onDiscardRef = useRef<(() => void) | null>(null);
  const onCancelRef = useRef<(() => void) | null>(null);

  const registerDirtyCheck = (fn: () => boolean) => {
    dirtyCheckRef.current = fn;
  };

  useEffect(() => {
    showDialogRef.current = showDialog;
  }, [showDialog]);

  const tryClose = (e?: Event) => {
    // A modal dialog answers a focus landing outside by refusing the dismissal, and a dropdown
    // menu restores focus to its trigger one tick after the item that opened this drawer: acting
    // on that event anyway would close the drawer the moment it appears.
    if (e?.defaultPrevented) {
      return;
    }
    if (showDialogRef.current) {
      e?.preventDefault();
      return;
    }
    if (dirtyCheckRef.current()) {
      e?.preventDefault();
      onDiscardRef.current = requestClose;
      setShowDialog(true);
    } else {
      requestClose();
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      tryClose();
    } else {
      baseHandleOpenChange(true);
    }
  };

  const confirmDiscard = (onDiscard: () => void, onCancel: () => void) => {
    onDiscardRef.current = onDiscard;
    onCancelRef.current = onCancel;
    setShowDialog(true);
  };

  const handleDiscard = () => {
    dirtyCheckRef.current = () => false;
    setShowDialog(false);
    onCancelRef.current = null;
    onDiscardRef.current?.();
    onDiscardRef.current = null;
  };

  // Runs on every way out of the dialog, Escape included: a held navigation waits on it.
  const handleCancel = () => {
    setShowDialog(false);
    onDiscardRef.current = null;
    onCancelRef.current?.();
    onCancelRef.current = null;
  };

  const closeDrawer = () => {
    dirtyCheckRef.current = () => false;
    requestClose();
  };

  return (
    <>
      <Sheet
        open={currentOpen}
        onOpenChange={handleOpenChange}
      >
        {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
        <DrawerContent
          className={className}
          onOpenAutoFocus={onOpenAutoFocus}
          onInteractOutside={(e) => tryClose(e)}
          onEscapeKeyDown={(e) => tryClose(e)}
        >
          <DrawerFormHeader category={category} title={title} />
          <FormDrawerContext.Provider value={{ registerDirtyCheck, isDirty: () => dirtyCheckRef.current(), confirmDiscard, closeDrawer }}>
            {children}
          </FormDrawerContext.Provider>
        </DrawerContent>
      </Sheet>
      <UnsavedChangesDialog open={showDialog} onStay={handleCancel} onDiscard={handleDiscard} />
    </>
  );
};
