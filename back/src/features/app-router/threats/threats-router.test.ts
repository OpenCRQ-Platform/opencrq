import { beforeEach, describe, expect, it, vi } from 'vitest';

// The tRPC instance reaches the logger, which parses the process config at import time.
vi.mock('../../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logWarn: vi.fn(), logError: vi.fn(), logFromError: vi.fn() }),
}));

const { trpcInstance } = await import('../../../trpc');
const { threatsRouter } = await import('./threats-router');

const THREAT_ID = '0198a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a5b';
const tenantId = '0198a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a5c';
const narrowed = { type: 'client', userId: 'user-1', tenantId, markings: ['marking-1'], openctiAccess: null } as const;

/** `readable` is what the reader's own origin reads, `existing` what exists once their OpenCTI scope is set aside. */
const isHiddenFor = (readable: boolean, existing: boolean) => {
  const withOrigin = vi.fn((origin: { markings?: unknown }) => ({
    threatAnalyses: { exists: () => Promise.resolve(origin.markings === undefined ? existing : readable) },
  }));
  const procedure = trpcInstance.procedure.use(({ next }) => next({ ctx: { services: { withOrigin }, origin: narrowed } }));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the router reads only the context fields set above
  const caller = threatsRouter(procedure as never).createCaller({} as never);
  return { call: () => caller.isHidden({ id: THREAT_ID }), withOrigin };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('threats.isHidden', () => {
  it('should answer false for a threat the reader reads, without looking past their OpenCTI scope', async () => {
    const { call, withOrigin } = isHiddenFor(true, true);

    expect(await call()).toBe(false);
    expect(withOrigin).toHaveBeenCalledTimes(1);
    expect(withOrigin).toHaveBeenCalledWith(narrowed);
  });

  it('should answer true for a threat that exists only once the reader\'s OpenCTI scope is set aside', async () => {
    const { call, withOrigin } = isHiddenFor(false, true);

    expect(await call()).toBe(true);
    expect(withOrigin).toHaveBeenLastCalledWith({ type: 'client', userId: 'user-1', tenantId, markings: undefined, openctiAccess: undefined });
  });

  it('should answer false for an id that exists nowhere the reader may look', async () => {
    expect(await isHiddenFor(false, false).call()).toBe(false);
  });
});
