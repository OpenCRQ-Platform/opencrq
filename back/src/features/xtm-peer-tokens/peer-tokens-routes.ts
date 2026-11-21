import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

/**
 * The provisioning API a deployment manager (SaaS Manager) calls to give a sibling XTM product
 * (an OpenAEV or an OpenCTI reading this platform) a service account and a token here, the way
 * OpenCTI and OpenAEV let it do the same with their bootstrap admin token. Authenticated by the
 * deployment's `APP__ADMIN__TOKEN` alone: no session, no tenant header.
 *
 * - `POST /api/xtm/peer-tokens` {consumer, name, email, token_name}: the account keyed by `email`
 *   in the initial tenant, in its Connectors group, created or converged; its live tokens named
 *   `token_name` revoked and a non-expiring one issued. 200 {user_id, email, name, token_name, token}.
 * - `POST /api/xtm/peer-tokens/revoke` {email, token_name}: those tokens revoked. 200 {revoked}.
 */

export const PEER_TOKENS_PATH = '/api/xtm/peer-tokens';
const BODY_LIMIT_BYTES = 8 * 1024;

export const peerTokenRequestSchema = z.object({
  consumer: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  email: z.email().max(320),
  token_name: z.string().trim().min(1).max(200),
});

export const peerTokenRevokeSchema = z.object({
  email: z.email().max(320),
  token_name: z.string().trim().min(1).max(200),
});

export type PeerTokenRequest = z.infer<typeof peerTokenRequestSchema>;

export interface PeerTokensDeps {
  /** The deployment's bootstrap admin token; unset turns the API off (404). */
  adminToken: string | undefined,
  /** Creates or converges the account, revokes the tokens named `tokenName`, issues a new one. */
  issue: (request: PeerTokenRequest) => Promise<{ serviceAccountId: string, plainToken: string }>,
  revoke: (email: string, tokenName: string) => Promise<number>,
  logError: (error: unknown, message: string) => void,
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Constant-time comparison of the bearer against the admin token (hashed first, so lengths match). */
export const isAdminBearer = (authorization: string | undefined, adminToken: string): boolean => {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  if (!match?.[1]) {
    return false;
  }
  return timingSafeEqual(digest(match[1]), digest(adminToken));
};

const authorize = (req: FastifyRequest, adminToken: string | undefined): 404 | 401 | null => {
  if (!adminToken) {
    return 404;
  }
  return isAdminBearer(req.headers.authorization, adminToken) ? null : 401;
};

export const registerPeerTokensRoutes = (server: FastifyInstance, deps: PeerTokensDeps): void => {
  server.post(PEER_TOKENS_PATH, { bodyLimit: BODY_LIMIT_BYTES }, async (req, reply) => {
    const refused = authorize(req, deps.adminToken);
    if (refused !== null) {
      return reply.code(refused).send({ error: refused === 404 ? 'Not found' : 'Unauthorized' });
    }
    const parsed = peerTokenRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues.map((issue) => issue.path.join('.')) });
    }
    const request = { ...parsed.data, email: parsed.data.email.toLowerCase() };
    try {
      const { serviceAccountId, plainToken } = await deps.issue(request);
      return reply.send({
        user_id: serviceAccountId,
        email: request.email,
        name: request.name,
        token_name: request.token_name,
        token: plainToken,
      });
    } catch (error) {
      deps.logError(error, 'Issuing a peer token failed');
      return reply.code(500).send({ error: 'Issuing the token failed' });
    }
  });

  server.post(`${PEER_TOKENS_PATH}/revoke`, { bodyLimit: BODY_LIMIT_BYTES }, async (req, reply) => {
    const refused = authorize(req, deps.adminToken);
    if (refused !== null) {
      return reply.code(refused).send({ error: refused === 404 ? 'Not found' : 'Unauthorized' });
    }
    const parsed = peerTokenRevokeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues.map((issue) => issue.path.join('.')) });
    }
    try {
      const revoked = await deps.revoke(parsed.data.email.toLowerCase(), parsed.data.token_name);
      return reply.send({ revoked });
    } catch (error) {
      deps.logError(error, 'Revoking a peer token failed');
      return reply.code(500).send({ error: 'Revoking the token failed' });
    }
  });
};
