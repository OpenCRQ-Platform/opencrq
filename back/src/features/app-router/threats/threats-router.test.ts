import { beforeEach, describe, expect, it, vi } from 'vitest';

// The tRPC instance reaches the logger, which parses the process config at import time.
vi.mock('../../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logWarn: vi.fn(), logError: vi.fn(), logFromError: vi.fn() }),
}));

const { trpcInstance } = await import('../../../trpc');
const { threatsRouter } = await import('./threats-router');

const list = vi.fn();
const services = { withOrigin: () => ({ threatAnalyses: { list } }) };
const tenantId = '0198a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a5b';
const reader = { type: 'client', userId: 'user-1', tenantId } as const;

const listAs = (origin: object) => {
  const procedure = trpcInstance.procedure.use(({ next }) => next({ ctx: { services, origin } }));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the router reads only the context fields set above
  return threatsRouter(procedure as never).createCaller({} as never).list({});
};

beforeEach(() => {
  list.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, limit: 50, pending: 0 });
});

describe('threats.list readerScopeUnresolved', () => {
  it('is true for a reader OpenCTI did not answer for', async () => {
    expect((await listAs({ ...reader, markings: null, openctiAccess: null })).readerScopeUnresolved).toBe(true);
  });

  it('is false for a reader whose markings OpenCTI gave, even none', async () => {
    expect((await listAs({ ...reader, markings: [], openctiAccess: null })).readerScopeUnresolved).toBe(false);
  });

  it('is false on a tenant with no OpenCTI connection, whose readers carry no scope', async () => {
    expect((await listAs(reader)).readerScopeUnresolved).toBe(false);
  });

  it('is false for a job or a connector, which no OpenCTI scope narrows', async () => {
    expect((await listAs({ ...reader, markings: null, job: { kind: 'crq-simulation', interactive: false } })).readerScopeUnresolved).toBe(false);
    expect((await listAs({ type: 'connector', serviceAccountId: 'sa-1', tenantId })).readerScopeUnresolved).toBe(false);
  });

  it('keeps what the service listed', async () => {
    list.mockResolvedValue({ items: [], total: 3, page: 1, limit: 50, pending: 1 });

    expect(await listAs({ ...reader, markings: null })).toEqual({ items: [], total: 3, page: 1, limit: 50, pending: 1, readerScopeUnresolved: true });
  });
});
