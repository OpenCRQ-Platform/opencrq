import { TRPCError } from '@trpc/server';
import { trpcInstance } from '../../trpc';

/**
 * For a write a service account must never make. The service refuses the connector origin too, but
 * with a plain error the formatter turns into an opaque 500, so an API client could not tell "you
 * may not" from "the server failed".
 */
export const userSessionOnly = trpcInstance.middleware(({ ctx, next }) => {
  if (ctx.serviceAccount) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This operation requires a user session, a service account token cannot perform it' });
  }
  return next();
});
