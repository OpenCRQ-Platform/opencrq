import type { TRPCRouter } from '@app/back/src/types/trpc-router';
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
 * `isLoaded` is false until an answer arrived, for the screen that words what it says by it.
 */
export const useReaderAccess = (): ReaderAccess & { isLoaded: boolean } => {
  const trpc = useTRPC();
  const { data, isSuccess } = useQuery(trpc.xtm.readerAccess.queryOptions(undefined, { retry: false, meta: { skipErrorToast: true } }));
  return { ...(data ?? NO_ISSUE), isLoaded: isSuccess };
};
