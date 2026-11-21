import { fastify } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { PeerTokensDeps } from './peer-tokens-routes';
import { isAdminBearer, PEER_TOKENS_PATH, registerPeerTokensRoutes } from './peer-tokens-routes';

const ADMIN_TOKEN = '3f8a6c2e-5b1d-4e7a-9c3f-2d8b6a4e1f07';
const BODY = { consumer: 'openaev', name: 'OpenAEV', email: 'OpenAEV@Peer.example', token_name: 'opencrq-link' };

const buildServer = (overrides: Partial<PeerTokensDeps> = {}) => {
  const deps: PeerTokensDeps = {
    adminToken: ADMIN_TOKEN,
    issue: vi.fn().mockResolvedValue({ serviceAccountId: 'sa-1', plainToken: 'flgrn_ocrq_tkn_x' }),
    revoke: vi.fn().mockResolvedValue(1),
    logError: vi.fn(),
    ...overrides,
  };
  const server = fastify();
  registerPeerTokensRoutes(server, deps);
  return { server, deps };
};

const post = (server: ReturnType<typeof fastify>, url: string, payload: unknown, token: string | null = ADMIN_TOKEN) =>
  server.inject({ method: 'POST', url, payload: payload as Record<string, unknown>, headers: token === null ? {} : { authorization: `Bearer ${token}` } });

describe('isAdminBearer', () => {
  it('accepts the admin token as a bearer and nothing else', () => {
    expect(isAdminBearer(`Bearer ${ADMIN_TOKEN}`, ADMIN_TOKEN)).toBe(true);
    expect(isAdminBearer(`bearer ${ADMIN_TOKEN}`, ADMIN_TOKEN)).toBe(true);
    expect(isAdminBearer(`Bearer ${ADMIN_TOKEN}x`, ADMIN_TOKEN)).toBe(false);
    expect(isAdminBearer(ADMIN_TOKEN, ADMIN_TOKEN)).toBe(false);
    expect(isAdminBearer(undefined, ADMIN_TOKEN)).toBe(false);
  });
});

describe('POST /api/xtm/peer-tokens', () => {
  it('issues a token for the account keyed by the lower-cased email', async () => {
    const { server, deps } = buildServer();
    const res = await post(server, PEER_TOKENS_PATH, BODY);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      user_id: 'sa-1',
      email: 'openaev@peer.example',
      name: 'OpenAEV',
      token_name: 'opencrq-link',
      token: 'flgrn_ocrq_tkn_x',
    });
    expect(deps.issue).toHaveBeenCalledWith({ ...BODY, email: 'openaev@peer.example' });
  });

  it('answers 401 without the admin bearer, and issues nothing', async () => {
    const { server, deps } = buildServer();
    expect((await post(server, PEER_TOKENS_PATH, BODY, null)).statusCode).toBe(401);
    expect((await post(server, PEER_TOKENS_PATH, BODY, 'a-wrong-token')).statusCode).toBe(401);
    expect(deps.issue).not.toHaveBeenCalled();
  });

  it('answers 404 when the deployment sets no admin token', async () => {
    const { server, deps } = buildServer({ adminToken: undefined });
    expect((await post(server, PEER_TOKENS_PATH, BODY)).statusCode).toBe(404);
    expect(deps.issue).not.toHaveBeenCalled();
  });

  it('answers 400 on a body missing a field', async () => {
    const { server, deps } = buildServer();
    const res = await post(server, PEER_TOKENS_PATH, { consumer: 'openaev', email: 'not-an-email', token_name: 't' });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues).toEqual(expect.arrayContaining(['name', 'email']));
    expect(deps.issue).not.toHaveBeenCalled();
  });

  it('answers 500 without the cause when issuing fails', async () => {
    const { server, deps } = buildServer({ issue: vi.fn().mockRejectedValue(new Error('db down')) });
    const res = await post(server, PEER_TOKENS_PATH, BODY);
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('db down');
    expect(deps.logError).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/xtm/peer-tokens/revoke', () => {
  it('revokes the named tokens of the account keyed by the email', async () => {
    const { server, deps } = buildServer();
    const res = await post(server, `${PEER_TOKENS_PATH}/revoke`, { email: 'OpenAEV@Peer.example', token_name: 'opencrq-link' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ revoked: 1 });
    expect(deps.revoke).toHaveBeenCalledWith('openaev@peer.example', 'opencrq-link');
  });

  it('answers 401 without the admin bearer', async () => {
    const { server, deps } = buildServer();
    expect((await post(server, `${PEER_TOKENS_PATH}/revoke`, { email: 'a@b.example', token_name: 't' }, null)).statusCode).toBe(401);
    expect(deps.revoke).not.toHaveBeenCalled();
  });
});
