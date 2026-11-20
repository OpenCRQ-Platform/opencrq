import { TRPCError } from '@trpc/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The tRPC telemetry middleware reaches the logger, which parses the process config at import time.
vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logError: vi.fn(), logFromError: vi.fn() }),
}));

const { protectedProcedure, router } = await import('../../trpc');
const { assertEnterpriseEdition, enterpriseProcedure } = await import('./edition-gate');
const { resetEditionState, setRemoteEntitlementExpiry } = await import('./edition-state');

/** An arbitrary window long enough to outlast this file's assertions. */
const grantRemote = () => setRemoteEntitlementExpiry(Date.now() + 10 * 60_000);

/** Minimal authenticated context: the gate runs after the auth middleware. */
const callerContext = {
  user: { id: 'user-1' },
  session: { id: 'session-1' },
  tenantId: undefined,
  serviceAccount: null,
};

const eeRouter = router({
  eeOnly: enterpriseProcedure(protectedProcedure, 'Multi-tenant').query(() => 'ok'),
});

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- only the fields the auth and gate middlewares read are needed here
const caller = eeRouter.createCaller(callerContext as never);

describe('enterprise edition gate', () => {
  afterEach(() => {
    resetEditionState();
  });

  it('assertEnterpriseEdition rejects with FORBIDDEN on a Community Edition platform', async () => {
    await expect(assertEnterpriseEdition('Multi-tenant')).rejects.toBeInstanceOf(TRPCError);
    // The feature is named so a caller is not left guessing which limit it hit.
    await expect(assertEnterpriseEdition('Multi-tenant')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('Multi-tenant'),
    });
  });

  it('assertEnterpriseEdition passes once the platform is entitled', async () => {
    grantRemote();
    await expect(assertEnterpriseEdition('Multi-tenant')).resolves.toBeUndefined();
  });

  it('answers FORBIDDEN on an EE-gated endpoint while the platform is CE', async () => {
    await expect(caller.eeOnly()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('runs an EE-gated endpoint normally once the platform is entitled', async () => {
    grantRemote();
    await expect(caller.eeOnly()).resolves.toBe('ok');
  });
});
