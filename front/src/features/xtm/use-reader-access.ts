import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { READER_SCOPE_TTL_MS } from '@app/utils/reader-scope';
import { useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import { useTRPC } from '../../lib';

type ReaderAccess = inferRouterOutputs<TRPCRouter>['xtm']['readerAccess'];

/** Why the reader's own rights in OpenCTI or OpenAEV fall short of what they could read there. */
export type ReaderAccessIssue = NonNullable<ReaderAccess['threats']>;

const NO_ISSUE: ReaderAccess = { threats: null, counterparts: { opencti: null, openaev: null } };

/**
 * Why a reader may see fewer threats, and fewer counterparts, than their rights allow: no issue
 * while it loads or when it cannot be told, since a notice that is wrong is worse than none.
 * `isPending` is true until the first answer or failure, for the screen that words what it says by it.
 */
export const useReaderAccess = (): ReaderAccess & { isPending: boolean } => {
  const trpc = useTRPC();
  // The answer changes with what the backend keeps of the reader's rights, which rings no doorbell.
  const { data, isPending } = useQuery(trpc.xtm.readerAccess.queryOptions(undefined, {
    retry: false,
    refetchInterval: READER_SCOPE_TTL_MS,
    meta: { skipErrorToast: true },
  }));
  return { ...(data ?? NO_ISSUE), isPending };
};
