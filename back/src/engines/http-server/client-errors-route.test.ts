import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DrizzleDB } from '@app/module';

// ── Stubs ────────────────────────────────────────────────────────────────────────────

const mockLogError = vi.fn();

vi.mock('../../trpc', () => ({
  resolveRequestAuth: () => () => Promise.resolve(),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logError: mockLogError }),
}));

const { registerClientErrorsRoute } = await import('./client-errors-route');

// ── Helpers ──────────────────────────────────────────────────────────────────────────

const registerHandler = (): { handler: (req: FastifyRequest, reply: FastifyReply) => Promise<void>, routeOptions: unknown } => {
  const server = { post: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal Fastify server stub for unit test
  registerClientErrorsRoute(server as unknown as FastifyInstance, {} as unknown as DrizzleDB);
  const [, routeOptions, handler] = server.post.mock.calls[0];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal Fastify server stub for unit test
  return { handler: handler as (req: FastifyRequest, reply: FastifyReply) => Promise<void>, routeOptions };
};

const validReport = {
  kind: 'transport',
  message: 'Failed to fetch',
  occurrences: 1,
  firstSeen: '2026-07-30T10:00:00.000Z',
  lastSeen: '2026-07-30T10:00:00.000Z',
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal Fastify request stub for unit test
const makeReq = (overrides: Record<string, unknown> = {}): FastifyRequest => ({
  authUser: { id: 'user-1' },
  headers: { 'x-tenant-id': 'tenant-1' },
  body: { reports: [validReport] },
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

describe('registerClientErrorsRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the route with a bodyLimit', () => {
    const { routeOptions } = registerHandler();

    expect(routeOptions).toEqual(expect.objectContaining({ bodyLimit: expect.any(Number) }));
  });

  it('logs one entry per report and replies ok on a valid batch', async () => {
    const { handler } = registerHandler();
    const secondReport = { ...validReport, kind: 'route', message: 'Second error' };
    const req = makeReq({ body: { reports: [validReport, secondReport] } });
    const reply = makeReply();

    await handler(req, reply);

    expect(mockLogError).toHaveBeenCalledTimes(2);
    expect(reply.send).toHaveBeenCalledWith({ status: 'ok' });
  });

  it('rejects with 400 and does not log when the payload is malformed', async () => {
    const { handler } = registerHandler();
    const req = makeReq({ body: {} });
    const reply = makeReply();

    await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Invalid report payload' });
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('rejects with 400 when the batch exceeds the cap', async () => {
    const { handler } = registerHandler();
    const req = makeReq({ body: { reports: Array.from({ length: 11 }, () => validReport) } });
    const reply = makeReply();

    await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('logs userId/tenantId and anonymous: false for an authenticated request', async () => {
    const { handler } = registerHandler();
    const req = makeReq();
    const reply = makeReply();

    await handler(req, reply);

    expect(mockLogError).toHaveBeenCalledWith('Client Error Report', expect.objectContaining({
      userId: 'user-1',
      tenantId: 'tenant-1',
      anonymous: false,
    }));
  });

  it('still replies ok and logs anonymous: true when there is no authenticated user', async () => {
    const { handler } = registerHandler();
    const req = makeReq({ authUser: null, headers: {} });
    const reply = makeReply();

    await handler(req, reply);

    expect(mockLogError).toHaveBeenCalledWith('Client Error Report', expect.objectContaining({
      userId: undefined,
      tenantId: undefined,
      anonymous: true,
    }));
    expect(reply.send).toHaveBeenCalledWith({ status: 'ok' });
  });

  it('never passes the raw request body to the logger', async () => {
    const { handler } = registerHandler();
    const req = makeReq();
    const reply = makeReply();

    await handler(req, reply);

    expect(mockLogError.mock.calls[0][1]).not.toHaveProperty('body');
  });
});
