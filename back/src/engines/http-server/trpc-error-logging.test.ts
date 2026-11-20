import { TRPCError } from '@trpc/server';
import type { TRPC_ERROR_CODE_KEY } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import { logTrpcError } from './trpc-error-logging';

const makeLogger = () => ({ logTraceFromError: vi.fn(), logFromError: vi.fn() });

const logCode = (code: TRPC_ERROR_CODE_KEY) => {
  const logger = makeLogger();
  const error = new TRPCError({ code, message: 'refused' });
  logTrpcError(logger, error, 'some.procedure');
  return { logger, error };
};

describe('logTrpcError', () => {
  it.each<TRPC_ERROR_CODE_KEY>(['CONFLICT', 'NOT_FOUND', 'PRECONDITION_FAILED', 'TOO_MANY_REQUESTS', 'PAYLOAD_TOO_LARGE'])('logs a %s as a trace', (code) => {
    const { logger, error } = logCode(code);

    expect(logger.logFromError).not.toHaveBeenCalled();
    expect(logger.logTraceFromError).toHaveBeenCalledWith(error, 'Request refused', { path: 'some.procedure' });
  });

  it('keeps the validation message for BAD_REQUEST', () => {
    const { logger, error } = logCode('BAD_REQUEST');

    expect(logger.logFromError).not.toHaveBeenCalled();
    expect(logger.logTraceFromError).toHaveBeenCalledWith(error, 'Validation Error', { path: 'some.procedure' });
  });

  it.each<TRPC_ERROR_CODE_KEY>(['UNAUTHORIZED', 'FORBIDDEN'])('keeps the auth message for %s', (code) => {
    const { logger, error } = logCode(code);

    expect(logger.logFromError).not.toHaveBeenCalled();
    expect(logger.logTraceFromError).toHaveBeenCalledWith(error, 'Auth error', { path: 'some.procedure' });
  });

  it.each<TRPC_ERROR_CODE_KEY>(['INTERNAL_SERVER_ERROR', 'NOT_IMPLEMENTED', 'SERVICE_UNAVAILABLE'])('logs a %s at error level', (code) => {
    const { logger, error } = logCode(code);

    expect(logger.logTraceFromError).not.toHaveBeenCalled();
    expect(logger.logFromError).toHaveBeenCalledWith(error, 'Internal Server Error', { path: 'some.procedure' });
  });
});
