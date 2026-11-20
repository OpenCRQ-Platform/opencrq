import type { TRPCError } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import type { Logger } from '../../utils/logger';

/**
 * A refusal answered with a 4xx is part of normal use (a stale write, a record already deleted),
 * so only a 5xx is logged at error level.
 */
export const logTrpcError = (logger: Pick<Logger, 'logTraceFromError' | 'logFromError'>, error: TRPCError, path: string | undefined): void => {
  if (getHTTPStatusCodeFromError(error) >= 500) {
    logger.logFromError(error, 'Internal Server Error', { path });
  } else if (error.code === 'BAD_REQUEST') {
    logger.logTraceFromError(error, 'Validation Error', { path });
  } else if (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN') {
    logger.logTraceFromError(error, 'Auth error', { path });
  } else {
    logger.logTraceFromError(error, 'Request refused', { path });
  }
};
