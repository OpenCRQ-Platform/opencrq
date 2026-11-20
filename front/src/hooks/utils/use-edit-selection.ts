import { useState } from 'react';

export const useEditSelection = () => {
  const [editId, setEditId] = useState<string | undefined>();

  const openEdit = (id: string) => {
    setEditId(id);
  };

  const closeEdit = () => {
    setEditId(undefined);
  };

  return { editId, isEditing: editId !== undefined, openEdit, closeEdit } as const;
};
