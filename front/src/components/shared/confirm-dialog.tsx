import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@filigran/design-system';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';

export interface ConfirmDialogProps {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onConfirm: () => void,
  title: ReactNode,
  description: ReactNode,
  submitButtonText: ReactNode,
}

/** Confirming closes the dialog, whether or not `onConfirm` touches `open`. */
export const ConfirmDialog: FunctionComponent<ConfirmDialogProps> = ({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  submitButtonText,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent size="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      <DialogFooter>
        <DialogClose asChild>
          <Button priority="secondary"><Trans>Cancel</Trans></Button>
        </DialogClose>
        <DialogClose asChild>
          <Button onClick={onConfirm}>{submitButtonText}</Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
