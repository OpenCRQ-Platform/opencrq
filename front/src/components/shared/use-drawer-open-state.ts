import { useState } from 'react';

interface UseDrawerOpenStateOptions {
  open?: boolean,
  onClose?: () => void,
}

interface UseDrawerOpenStateResult {
  currentOpen: boolean,
  handleOpenChange: (isOpen: boolean) => void,
  requestClose: () => void,
}

export const useDrawerOpenState = ({ open: openProp, onClose }: UseDrawerOpenStateOptions): UseDrawerOpenStateResult => {
  const isControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const currentOpen = isControlled ? openProp : uncontrolledOpen;

  const requestClose = () => {
    if (!isControlled) {
      setUncontrolledOpen(false);
    }
    onClose?.();
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      requestClose();
    } else if (!isControlled) {
      setUncontrolledOpen(true);
    }
  };

  return { currentOpen, handleOpenChange, requestClose };
};
