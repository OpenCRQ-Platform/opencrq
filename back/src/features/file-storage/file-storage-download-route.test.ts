import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DrizzleDB } from '@app/module';
import type * as AppModule from '@app/module';

const mockReadFile = vi.fn();
const mockGetTenants = vi.fn();

// The reachability check reaches the edition state, whose IPC relay reaches the
// logger, which parses the process config at import time.
vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logError: vi.fn(), logFromError: vi.fn() }),
}));

vi.mock('../../trpc', () => ({
  resolveRequestAuth: () => () => Promise.resolve(),
  XTM_ONE_SESSION_ID: 'xtm-one-session',
}));

vi.mock('../../services/file-storage', () => ({
  FileNotFoundError: class FileNotFoundError extends Error {},
  fileStorageOperations: { readFile: (...args: Array<unknown>) => mockReadFile(...args) },
}));

vi.mock('@app/module', async (importOriginal) => ({
  ...(await importOriginal<typeof AppModule>()),
  createServices: vi.fn().mockReturnValue({
    withOrigin: () => ({ tenants: { getTenants: () => mockGetTenants() } }),
  }),
  tenantsService: {},
}));

const { registerFileStorageDownloadRoute } = await import('./file-storage-download-route');
const { resetEditionState, setRemoteEntitlementExpiry } = await import('../edition/edition-state');

type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const registerHandler = (): Handler => {
  const server = { get: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal Fastify server stub for unit test
  registerFileStorageDownloadRoute(server as unknown as FastifyInstance, {} as unknown as DrizzleDB);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal Fastify server stub for unit test
  return server.get.mock.calls[0][1] as Handler;
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal Fastify request stub for unit test
const makeReq = (overrides: Record<string, unknown> = {}): FastifyRequest => ({
  authUser: { id: 'user-1' },
  authSession: { id: 'session-1' },
  headers: { 'x-tenant-id': 'tenant-1' },
  query: {},
  params: { id: 'file-1' },
  ...overrides,
}) as unknown as FastifyRequest;

const makeReply = () => {
  const reply = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
  };
  return reply;
};

describe('the file download route', () => {
  beforeEach(() => {
    mockReadFile.mockReset().mockResolvedValue({
      originalName: 'bundle.json',
      mimeType: 'application/json',
      stream: Readable.from(['{}']),
    });
    mockGetTenants.mockReset().mockResolvedValue([{ id: 'tenant-1' }]);
  });

  afterEach(() => {
    resetEditionState();
  });

  it('streams the file when the platform reaches the tenant the header claims', async () => {
    const reply = makeReply();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal Fastify reply stub for unit test
    await registerHandler()(makeReq(), reply as unknown as FastifyReply);

    expect(mockReadFile).toHaveBeenCalled();
    expect(reply.code).not.toHaveBeenCalledWith(403);
  });

  it('refuses a tenant this edition does not reach, without reading the file', async () => {
    // This route reads `x-tenant-id` itself rather than going through the tRPC
    // middleware, so nothing else would refuse it on a Community platform.
    mockGetTenants.mockResolvedValue([{ id: 'tenant-0' }, { id: 'tenant-1' }]);
    const reply = makeReply();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal Fastify reply stub for unit test
    await registerHandler()(makeReq(), reply as unknown as FastifyReply);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('serves any tenant once the platform is entitled', async () => {
    setRemoteEntitlementExpiry(Date.now() + 60_000);
    mockGetTenants.mockResolvedValue([{ id: 'tenant-0' }, { id: 'tenant-1' }]);
    const reply = makeReply();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal Fastify reply stub for unit test
    await registerHandler()(makeReq(), reply as unknown as FastifyReply);

    expect(mockReadFile).toHaveBeenCalled();
    expect(reply.code).not.toHaveBeenCalledWith(403);
  });

  it('answers 401 without a session, before asking anything about tenants', async () => {
    const reply = makeReply();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal Fastify reply stub for unit test
    await registerHandler()(makeReq({ authUser: null, authSession: null }), reply as unknown as FastifyReply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(mockGetTenants).not.toHaveBeenCalled();
  });
});
