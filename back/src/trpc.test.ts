import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The tRPC telemetry middleware reaches the logger, which parses the process config at import time.
vi.mock('./utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn() }),
}));

const { publicProcedure, router, sessionExpirySignal } = await import('./trpc');
const { schema } = await import('@app/module');
const { installQueryDependencyIndex, QueryDependencyIndex } = await import('./features/events/query-dependency-index');

describe('the query observation middleware', () => {
  afterEach(() => {
    installQueryDependencyIndex(null);
  });

  it('hands the tables a query declares in its meta to the dependency index', async () => {
    const index = new QueryDependencyIndex({ explain: () => Promise.reject(new Error('no plan expected')) });
    installQueryDependencyIndex(index);
    const caller = router({
      declared: publicProcedure.meta({ reads: [schema.users] }).query(() => 'declared'),
      undeclared: publicProcedure.query(() => 'undeclared'),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a public procedure reads no field of the context
    }).createCaller({} as never);

    await caller.declared();
    await caller.undeclared();

    expect(index.readsOf('declared')).toEqual(['users']);
    expect(index.targetsOf(['jobs']).procedures).toEqual(['undeclared']);
  });
});

describe('sessionExpirySignal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts immediately when the session is already expired', () => {
    const { signal } = sessionExpirySignal(new Date('2025-12-31T23:59:59Z'));
    expect(signal.aborted).toBe(true);
  });

  it('aborts exactly at the session expiry, not a tick before', () => {
    const { signal, dispose } = sessionExpirySignal(new Date('2026-01-01T00:00:10Z'));
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(9_999);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    dispose();
  });

  it('dispose() clears the timer so the signal never aborts on its own', () => {
    const { signal, dispose } = sessionExpirySignal(new Date('2026-01-01T00:00:10Z'));
    dispose();
    vi.advanceTimersByTime(60_000);
    expect(signal.aborted).toBe(false);
  });
});
