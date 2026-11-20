import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';
import { ConfirmDialog } from './confirm-dialog';

interface DeleteConfirmDialogProps {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onConfirm: () => void,
  title: ReactNode,
  description: ReactNode,
  submitButtonText?: ReactNode,
}

/**
 * Reusable delete confirmation dialog.
 * Wraps AlertDialog with standard delete confirmation UI.
 */
export const DeleteConfirmDialog: FunctionComponent<DeleteConfirmDialogProps> = ({
  open, onOpenChange, onConfirm, title, description, submitButtonText,
}) => (
  <ConfirmDialog
    open={open}
    onOpenChange={onOpenChange}
    onConfirm={onConfirm}
    title={title}
    description={description}
    submitButtonText={submitButtonText ?? <Trans>Delete</Trans>}
  />
);
