import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DrizzleDB } from '@app/module';
import type * as AppModule from '@app/module';

// ── Stubs ────────────────────────────────────────────────────────────────────────────

const mockWriteFile = vi.fn();
const mockEnqueueJob = vi.fn();
const mockLogFromError = vi.fn();

const mockGetTenants = vi.fn().mockResolvedValue([{ id: 'tenant-1' }]);

const mockWithOrigin = vi.fn().mockReturnValue({
  jobs: { enqueueJob: mockEnqueueJob },
  // The route asks whether this edition reaches the tenant the header claims;
  // the process-local default is Community, so `tenant-1` has to be the one
  // tenant such a platform serves for the rest of this suite to reach the route.
  tenants: { getTenants: () => mockGetTenants() },
});

vi.mock('../../trpc', () => ({
  resolveRequestAuth: () => () => Promise.resolve(),
  XTM_ONE_SESSION_ID: 'xtm-one-session',
}));

vi.mock('../file-storage', () => ({
  fileStorageOperations: { writeFile: mockWriteFile },
}));

// Real `originTrigger`, so the pair asserted below is the one it derives rather than a stub's.
vi.mock('@app/module', async (importOriginal) => ({
  ...(await importOriginal<typeof AppModule>()),
  createServices: vi.fn().mockReturnValue({ withOrigin: mockWithOrigin }),
  jobsService: {},
}));

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logFromError: mockLogFromError }),
}));

const { registerUploadJobRoute } = await import('./upload-job-route');

// ── Helpers ──────────────────────────────────────────────────────────────────────────

const options = {
  path: '/api/threats/upload',
  jobKind: 'threat-bundle-analysis',
  idempotencyKeyPrefix: 'threat-bundle',
  featureKey: 'threat-uploader',
  uploadFailedMessage: 'STIX bundle upload failed',
};

const registerHandler = (): (req: FastifyRequest, reply: FastifyReply) => Promise<void> => {
  const server = { post: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal Fastify server stub for unit test
  registerUploadJobRoute(server as unknown as FastifyInstance, {} as unknown as DrizzleDB, options);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal Fastify server stub for unit test
  return server.post.mock.calls[0][1] as (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal Fastify request stub for unit test
const makeReq = (overrides: Record<string, unknown> = {}): FastifyRequest => ({
  authUser: { id: 'user-1' },
  authSession: { id: 'session-1' },
  headers: { 'x-tenant-id': 'tenant-1' },
  file: vi.fn().mockResolvedValue({
    file: Readable.from(['bundle contents']),
    filename: 'bundle.json',
    mimetype: 'application/json',
  }),
  ...overrides,
}) as unknown as FastifyRequest;

const makeReply = (): FastifyReply => {
  const reply = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal Fastify reply stub for unit test
  return reply as unknown as FastifyReply;
};

// ── Tests ────────────────────────────────────────────────────────────────────────────

describe('registerUploadJobRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Drains the piped hashing stream fully before resolving, mirroring the real
    // `fileStorageOperations.writeFile` (which reads the whole upload stream to send it to
    // storage) — required so the hashing Transform finishes updating the sha256 digest before
    // the route calls `sha256.digest('hex')` right after awaiting this mock.
    mockWriteFile.mockImplementation(async (_db: unknown, _origin: unknown, input: { stream: AsyncIterable<unknown> }) => {
      for await (const _chunk of input.stream) {
        // drain only
      }
      return { id: 'stored-file-1' };
    });
    mockEnqueueJob.mockResolvedValue({ jobId: 'job-1' });
  });

  it('rejects with 401 when there is no authenticated user', async () => {
    const handler = registerHandler();
    const req = makeReq({ authUser: null });
    const reply = makeReply();

    await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('rejects with 401 for the synthetic XTM One session', async () => {
    const handler = registerHandler();
    const req = makeReq({ authSession: { id: 'xtm-one-session' } });
    const reply = makeReply();

    await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('rejects with 401 for a service-account bearer token', async () => {
    // Service-account tokens never populate `authUser`/`authSession` (see resolveRequestAuth in
    // trpc.ts) — only `authServiceAccount`. This route is a browser-only surface, so it must stay
    // 401 even though a service account was successfully authenticated upstream.
    const handler = registerHandler();
    const req = makeReq({ authUser: null, authSession: null, authServiceAccount: { id: 'service-account-1', tenantId: 'tenant-1' } });
    const reply = makeReply();

    await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('rejects with 400 when the x-tenant-id header is missing', async () => {
    const handler = registerHandler();
    const req = makeReq({ headers: {} });
    const reply = makeReply();

    await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Missing x-tenant-id header' });
  });

  it('rejects with 403 when the edition does not reach the tenant the header claims', async () => {
    // Membership is not the question here: this route reads `x-tenant-id`
    // itself, outside the tRPC middleware, so a Community platform serving
    // another tenant has to be refused on this path too.
    mockGetTenants.mockResolvedValueOnce([{ id: 'tenant-0' }, { id: 'tenant-1' }]);
    const handler = registerHandler();
    const req = makeReq();
    const reply = makeReply();

    await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it('rejects with 400 when no file part is uploaded', async () => {
    const handler = registerHandler();
    const req = makeReq({ file: vi.fn().mockResolvedValue(undefined) });
    const reply = makeReply();

    await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: 'No file uploaded' });
  });

  it('stores the file and enqueues the job on the happy path', async () => {
    const handler = registerHandler();
    const req = makeReq();
    const reply = makeReply();

    await handler(req, reply);

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockEnqueueJob).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'threat-bundle-analysis',
      tenantId: 'tenant-1',
      payload: { storedFileId: 'stored-file-1', userId: 'user-1' },
      idempotencyKey: expect.stringMatching(/^threat-bundle-/),
      triggeredBy: 'user',
      triggeredById: 'user-1',
    }));
    expect(reply.send).toHaveBeenCalledWith({ jobId: 'job-1' });
  });

  it('responds with 500 and logs the error when storing the file fails', async () => {
    const handler = registerHandler();
    const req = makeReq();
    const reply = makeReply();
    const error = new Error('boom');
    mockWriteFile.mockRejectedValue(error);

    await handler(req, reply);

    expect(mockLogFromError).toHaveBeenCalledWith(error, options.uploadFailedMessage, { tenantId: 'tenant-1', userId: 'user-1' });
    expect(reply.code).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Upload failed' });
  });
});
