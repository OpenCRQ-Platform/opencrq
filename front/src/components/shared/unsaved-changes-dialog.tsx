import { Button, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';

interface UnsavedChangesDialogProps {
  open: boolean,
  /** Runs on every way out of the dialog but Discard, Escape included: a held navigation waits on it. */
  onStay: () => void,
  onDiscard: () => void,
  /** Already translated; the defaults word a modified form. */
  title?: string,
  description?: string,
  discardLabel?: string,
}

/** Asks whether to discard a modified form the reader is leaving. */
export const UnsavedChangesDialog: FunctionComponent<UnsavedChangesDialogProps> = ({ open, onStay, onDiscard, title, description, discardLabel }) => (
  <Dialog
    open={open}
    onOpenChange={(isOpen) => {
      if (!isOpen) {
        onStay();
      }
    }}
  >
    <DialogContent size="sm">
      <DialogTitle>{title ?? t`Unsaved changes`}</DialogTitle>
      <DialogDescription>{description ?? t`You have unsaved changes. Do you want to discard them?`}</DialogDescription>
      <DialogFooter>
        <DialogClose asChild>
          <Button priority="secondary">{t`Cancel`}</Button>
        </DialogClose>
        <Button onClick={onDiscard}>{discardLabel ?? t`Discard`}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
