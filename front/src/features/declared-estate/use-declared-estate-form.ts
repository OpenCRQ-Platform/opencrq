import type { DeclaredEstateKind } from '@app/module/client';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { DeclaredEstateDraft } from './declared-estate-utils';
import { useTRPC } from '../../lib';
import { changedAnswers, hasDraftErrors, hasUnsavedDrafts, resolveDrafts } from './declared-estate-utils';

type Drafts = Partial<Record<DeclaredEstateKind, DeclaredEstateDraft>>;

/**
 * A scope's declared estate as a form. Only the kinds the reader touched are held locally, so a
 * refetch the doorbell triggers refreshes every untouched kind and never resets one being answered;
 * a save sends those kinds alone, and the caller puts its outcome into words.
 */
export const useDeclaredEstateForm = (organizationId: string) => {
  const trpc = useTRPC();
  const { data: stored, isLoading } = useQuery(trpc.declaredEstate.get.queryOptions({ organizationId }));
  const [edited, setEdited] = useState<Drafts>({});
  const saveMutation = useMutation(trpc.declaredEstate.save.mutationOptions({ meta: { skipSuccessToast: true } }));

  const rows = stored ?? [];
  const answers = changedAnswers(edited, rows);

  return {
    isLoading,
    drafts: resolveDrafts(edited, rows),
    isDirty: hasUnsavedDrafts(edited, rows),
    hasErrors: hasDraftErrors(edited),
    isSaving: saveMutation.isPending,
    setDraft: (kind: DeclaredEstateKind, draft: DeclaredEstateDraft) => setEdited((previous) => ({ ...previous, [kind]: draft })),
    save: async () => {
      await saveMutation.mutateAsync({ organizationId, answers });
      setEdited({});
    },
  };
};
