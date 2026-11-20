import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtmOneSettings } from './xtm-one-config';

// The tRPC instance reaches the logger, which parses the process config at import time.
vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logError: vi.fn(), logFromError: vi.fn() }),
}));

let settings: XtmOneSettings | null;
vi.mock('./xtm-one-config', () => ({
  getXtmOneSettings: () => settings,
}));

// The published identity is read over the network; this suite is about the registration state.
vi.mock('./xtm-one-identity', () => ({
  resolveXtmOneIdentity: (resolved: XtmOneSettings) => Promise.resolve(resolved.url),
}));

const { protectedProcedure } = await import('../../trpc');
const { xtmOneRouter } = await import('./xtm-one-router');
const {
  recordRegistrationFailure,
  recordRegistrationSuccess,
  resetXtmOneReachability,
} = await import('./xtm-one-reachability');

const SETTINGS: XtmOneSettings = {
  url: 'https://xtm-one.example.com',
  token: 'registration-token',
  platformUrl: 'https://opencrq.example.com',
};

/** Minimal authenticated context: the gate runs after the auth middleware. */
const callerContext = {
  user: { id: 'user-1' },
  session: { id: 'session-1' },
  tenantId: undefined,
  serviceAccount: null,
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- only the fields the auth middleware reads are needed here
const caller = xtmOneRouter(protectedProcedure).createCaller(callerContext as never);

describe('xtmOne.getSettings', () => {
  beforeEach(() => {
    settings = null;
    resetXtmOneReachability();
  });

  it('reports unconfigured with no registration state when the block is absent', async () => {
    await expect(caller.getSettings()).resolves.toEqual({ configured: false, url: null, entitlementRefusal: null, registration: null, failingSince: null, lastAnsweredAt: null });
  });

  it('reports pending once configured but before any registration attempt', async () => {
    settings = SETTINGS;

    await expect(caller.getSettings()).resolves.toEqual({ configured: true, url: SETTINGS.url, entitlementRefusal: null, registration: 'pending', failingSince: null, lastAnsweredAt: null });
  });

  it('reports the failure cause after a refused attempt', async () => {
    settings = SETTINGS;
    recordRegistrationFailure('refused', Date.UTC(2026, 8, 30, 10, 27));

    await expect(caller.getSettings()).resolves.toMatchObject({ registration: 'refused', failingSince: new Date(Date.UTC(2026, 8, 30, 10, 27)) });
  });

  it('reports ok after a successful attempt', async () => {
    settings = SETTINGS;
    recordRegistrationSuccess(Date.UTC(2026, 10, 6, 9, 0));

    await expect(caller.getSettings()).resolves.toMatchObject({ registration: 'ok', failingSince: null });
  });

  it('reports when XTM One last answered, through a later failure', async () => {
    settings = SETTINGS;
    recordRegistrationSuccess(Date.UTC(2026, 10, 6, 9, 0));
    recordRegistrationFailure('unreachable', Date.UTC(2026, 10, 6, 9, 5));

    await expect(caller.getSettings()).resolves.toMatchObject({ lastAnsweredAt: new Date(Date.UTC(2026, 10, 6, 9, 0)) });
  });
});
