import { useState } from 'react';

interface UseConfirmationDialogReturn {
  /** The ID of the entity pending confirmation, or null. */
  pendingId: string | null,
  /** Whether the confirmation dialog is open. */
  isOpen: boolean,
  /** Opens the confirmation dialog for the given entity ID. */
  requestConfirmation: (id: string) => void,
  /** Confirms the action and closes the dialog. Returns the ID that was pending. */
  confirm: () => string | null,
  /** Cancels the action and closes the dialog. */
  cancel: () => void,
}

/**
 * Manages the state for a generic confirmation dialog.
 * Provides a simple state machine: closed → open (with pending ID) → confirmed/cancelled → closed.
 */
export const useConfirmationDialog = (): UseConfirmationDialogReturn => {
  const [pendingId, setPendingId] = useState<string | null>(null);

  const requestConfirmation = (id: string) => {
    setPendingId(id);
  };

  const confirm = () => {
    const id = pendingId;
    setPendingId(null);
    return id;
  };

  const cancel = () => {
    setPendingId(null);
  };

  return {
    pendingId,
    isOpen: pendingId !== null,
    requestConfirmation,
    confirm,
    cancel,
  };
};
