import type { StructuredError } from '@app/utils';
import type { TRPC_ERROR_CODE_KEY } from '@trpc/server';
import { TRPCError } from '@trpc/server';

const withCodeOn = (code: TRPC_ERROR_CODE_KEY) => async <T, E extends StructuredError>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- error subclasses have differing constructor signatures
  ErrorClass: new (...args: Array<any>) => E,
  fn: () => Promise<T>,
): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ErrorClass) {
      throw new TRPCError({ code, message: error.messageKey, cause: error });
    }
    throw error;
  }
};

/**
 * Maps a domain `StructuredError` of the given class to a tRPC `CONFLICT`, letting every other
 * error (including other `StructuredError` subclasses) fall through unchanged.
 */
export const withConflictOn = withCodeOn('CONFLICT');

/** The same mapping to `BAD_REQUEST`, for a domain refusal of the input itself. */
export const withBadRequestOn = withCodeOn('BAD_REQUEST');

/** The same mapping to `NOT_FOUND`, for an id the caller's tenant cannot see. */
export const withNotFoundOn = withCodeOn('NOT_FOUND');
