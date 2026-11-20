import { afterEach, describe, expect, it, vi } from 'vitest';

// The tRPC instance reaches the logger, which parses the process config at import time.
vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logError: vi.fn(), logFromError: vi.fn() }),
}));

const { protectedProcedure } = await import('../../trpc');
const { editionRouter } = await import('./edition-router');
const {
  beginEditionResolution,
  markEditionResolved,
  resetEditionState,
  setLocalEntitlementExpiry,
  setRemoteEntitlementExpiry,
} = await import('./edition-state');

/** Minimal authenticated context: the gate runs after the auth middleware. */
const callerContext = {
  user: { id: 'user-1' },
  session: { id: 'session-1' },
  tenantId: undefined,
  serviceAccount: null,
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- only the fields the auth middleware reads are needed here
const caller = editionRouter(protectedProcedure).createCaller(callerContext as never);

describe('edition.getStatus', () => {
  afterEach(() => {
    resetEditionState();
  });

  it('reports Community Edition with no dates by default', async () => {
    await expect(caller.getStatus()).resolves.toEqual({ edition: 'ce', endsAt: null, licenseExpiresAt: null, licenseSource: null, licenseType: null });
  });

  it('reports when Enterprise Edition ends and when its license expires, apart, with the license type', async () => {
    const expiresAt = Date.now() + 1_000;
    const licenseExpiresAt = Date.now() + 180 * 24 * 60 * 60 * 1000;
    setRemoteEntitlementExpiry(expiresAt, licenseExpiresAt, 'nfr');

    await expect(caller.getStatus()).resolves.toEqual({
      edition: 'ee',
      endsAt: new Date(expiresAt),
      licenseExpiresAt: new Date(licenseExpiresAt),
      licenseSource: 'remote',
      licenseType: 'nfr',
    });
  });

  it('reports no license date for a grant no license proves', async () => {
    const expiresAt = Date.now() + 1_000;
    setRemoteEntitlementExpiry(expiresAt, null);

    await expect(caller.getStatus()).resolves.toEqual({ edition: 'ee', endsAt: new Date(expiresAt), licenseExpiresAt: null, licenseSource: 'remote', licenseType: null });
  });

  it('reports no end for the development build\'s never-expiring grant', async () => {
    setRemoteEntitlementExpiry(Number.MAX_SAFE_INTEGER);

    await expect(caller.getStatus()).resolves.toEqual({ edition: 'ee', endsAt: null, licenseExpiresAt: null, licenseSource: 'remote', licenseType: null });
  });

  it('reports an installed Filigran license as the local form', async () => {
    const expiresAt = Date.now() + 1_000;
    setLocalEntitlementExpiry(expiresAt, expiresAt, 'standard');

    await expect(caller.getStatus()).resolves.toEqual({
      edition: 'ee',
      endsAt: new Date(expiresAt),
      licenseExpiresAt: new Date(expiresAt),
      licenseSource: 'local',
      licenseType: 'standard',
    });
  });

  it('awaits the first resolution before answering', async () => {
    beginEditionResolution();
    let settled = false;
    const pending = caller.getStatus().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    markEditionResolved();
    await pending;
    expect(settled).toBe(true);
  });
});
