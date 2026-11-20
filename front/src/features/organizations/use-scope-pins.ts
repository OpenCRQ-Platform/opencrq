import { eq, useLiveQuery } from '@tanstack/react-db';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ScopeMemory } from './scope-memory-utils';
import { useTRPC } from '../../lib';
import { useTenant } from '../../providers';
import { useLoggedUser } from '../../providers/logged-user-provider';
import { scopeMemoryCollection } from '../../stores';
import { afterPinChanged, afterPinFailed, EMPTY_SCOPE_MEMORY, sameScopeMemory, withPinned } from './scope-memory-utils';

const readScopeMemory = (key: string): ScopeMemory => {
  const stored = scopeMemoryCollection.get(key);
  return stored ? { lastScopeId: stored.lastScopeId, unpinnedScopeId: stored.unpinnedScopeId } : EMPTY_SCOPE_MEMORY;
};

export const updateScopeMemory = (key: string, update: (memory: ScopeMemory) => ScopeMemory): void => {
  const current = readScopeMemory(key);
  const next = update(current);
  if (sameScopeMemory(current, next)) {
    return;
  }
  if (scopeMemoryCollection.has(key)) {
    scopeMemoryCollection.update(key, (draft) => {
      draft.lastScopeId = next.lastScopeId;
      draft.unpinnedScopeId = next.unpinnedScopeId;
    });
  } else {
    scopeMemoryCollection.insert({ id: key, ...next });
  }
};

export const useScopeMemory = (tenantId: string): { key: string, memory: ScopeMemory } => {
  const { userId } = useLoggedUser();
  const key = `${userId}:${tenantId}`;
  const { data } = useLiveQuery({
    query: (q) =>
      q.from({ el: scopeMemoryCollection })
        .where(({ el }) => eq(el.id, key))
        .findOne(),
  });
  return {
    key,
    memory: data ? { lastScopeId: data.lastScopeId, unpinnedScopeId: data.unpinnedScopeId } : EMPTY_SCOPE_MEMORY,
  };
};

/** Written to the cache before the server answers, so the bar follows the click at once. */
export const useScopePins = () => {
  const { tenantId } = useTenant();
  const { userId } = useLoggedUser();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const unpinnedKey = trpc.organizations.getUnpinnedOrganizationIds.queryKey();
  const { data: unpinnedIds } = useQuery(trpc.organizations.getUnpinnedOrganizationIds.queryOptions());

  const setOrganizationPinned = useMutation(trpc.organizations.setOrganizationPinned.mutationOptions({
    meta: { skipSuccessToast: true },
    // Sent one at a time: two toggles of one scope racing would leave the server on the first click.
    scope: { id: 'scope-pins' },
    onMutate: ({ id, pinned }) => {
      const wasPinned = !(queryClient.getQueryData(unpinnedKey) ?? []).includes(id);
      queryClient.setQueryData(unpinnedKey, (ids = []) => withPinned(ids, id, pinned));
      // The rollback holds the query itself: a key is hashed with the tenant committed when it is read.
      const query = queryClient.getQueryCache().find<Array<string>>({ queryKey: unpinnedKey, exact: true });
      const memoryKey = `${userId}:${tenantId}`;
      const memoryBefore = readScopeMemory(memoryKey);
      updateScopeMemory(memoryKey, (memory) => afterPinChanged(memory, id, pinned));
      return { wasPinned, query, memoryKey, memoryBefore, memoryAfter: readScopeMemory(memoryKey) };
    },
    onError: (_error, { id }, context) => {
      if (!context) {
        return;
      }
      const { wasPinned, query, memoryKey, memoryBefore, memoryAfter } = context;
      query?.setData(withPinned(query.state.data ?? [], id, wasPinned), { manual: true });
      updateScopeMemory(memoryKey, (memory) => afterPinFailed(memory, memoryBefore, memoryAfter));
    },
  }));

  const unpinned = new Set(unpinnedIds ?? []);
  return {
    isPinned: (id: string) => !unpinned.has(id),
    setPinned: (id: string, pinned: boolean) => setOrganizationPinned.mutate({ id, pinned }),
  };
};
