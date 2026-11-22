import '@fastify/cookie';
import { authService, createServices, serviceAccountTokensService } from '@app/module';
import type { ConnectorOrigin, DrizzleDB, UserOrigin } from '@app/module';
import { StructuredError } from '@app/utils';
import { initTRPC, TRPCError } from '@trpc/server';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import { getTableName } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { observeQueryProcedure } from './features/events/query-dependency-index';
import { authenticateXtmOneJwt, looksLikeJwt, XTM_ONE_SESSION_ID } from './features/xtm-one/xtm-one-auth';
import { isAdminToken } from './features/xtm-peer-tokens/peer-tokens-routes';
import { MAX_RESPONSE_ITEMS_DEFAULT } from './config-schema';
import { instrumentTrpcCall } from './utils/trpc-telemetry';

// Re-exported from the shared auth surface so plain HTTP routes (e.g. the threat upload
// route) can reject the synthetic XTM One JWT session without importing the xtm-one feature.
export { XTM_ONE_SESSION_ID };

const IS_PROD = process.env.NODE_ENV === 'production';

const SESSION_COOKIE_BASE_NAME = 'app::auth_session';

let sessionCookieName = SESSION_COOKIE_BASE_NAME;

/**
 * Dev-only: browsers scope cookies by host and ignore the port, so two dev stacks on
 * localhost share one cookie jar and each backend clears the other's session cookie.
 * Suffixing the name with the backend port isolates each instance. No-op in production.
 * Must be called before the server accepts requests (the http-server engine does, at start).
 */
export const scopeSessionCookieToPort = (port: number): void => {
  if (!IS_PROD) {
    sessionCookieName = `${SESSION_COOKIE_BASE_NAME}::${port}`;
  }
};

export const getSessionCookieName = (): string => sessionCookieName;

let maxResponseItems = MAX_RESPONSE_ITEMS_DEFAULT;

export const setMaxResponseItems = (value: number): void => {
  maxResponseItems = value;
};

export const COOKIE_OPTIONS = {
  path: '/',
  secure: IS_PROD,
  httpOnly: true,
  sameSite: IS_PROD ? ('none' as const) : ('lax' as const),
  maxAge: 60 * 60 * 24 * 30,
};

export const authenticateSession = (db: DrizzleDB, sessionId: string) => createServices([authService], db)
  .withOrigin({ type: 'auth' })
  .auth.validateSession(sessionId);

export const sessionExpirySignal = (expiresAt: Date): { signal: AbortSignal, dispose: () => void } => {
  const controller = new AbortController();
  const msUntilExpiry = expiresAt.getTime() - Date.now();
  if (msUntilExpiry <= 0) {
    controller.abort();
    return { signal: controller.signal, dispose: () => undefined };
  }
  const timer = setTimeout(() => controller.abort(), msUntilExpiry);
  return { signal: controller.signal, dispose: () => clearTimeout(timer) };
};

type AuthenticatedSession = NonNullable<Awaited<ReturnType<typeof authenticateSession>>>;
export type AuthUser = AuthenticatedSession['user'];

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser | null,
    authSession: AuthenticatedSession['session'] | null,
    authServiceAccount: { id: string, tenantId: string } | null,
    authResolved: boolean,
  }
}

/**
 * The deployment's `APP__ADMIN__TOKEN` as a bearer, the way OpenCTI's admin token is one: set once
 * the account it acts as is provisioned (the initial tenant's Admin group), `null` while it is not or
 * when no admin token is configured. A request carrying it is that service account.
 */
export interface AdminBearer {
  readonly token: string,
  readonly serviceAccountId: string,
  readonly tenantId: string,
}

let adminBearer: AdminBearer | null = null;

export const setAdminBearer = (value: AdminBearer | null): void => {
  adminBearer = value;
};

const authenticateServiceAccountToken = (db: DrizzleDB, rawToken: string) =>
  createServices([serviceAccountTokensService], db)
    .withOrigin({ type: 'system' })
    .serviceAccountTokens.validateToken(rawToken);

export const resolveRequestAuth = (db: DrizzleDB) => async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  if (req.authResolved) {
    return;
  }
  req.authResolved = true;

  const sessionId = req.cookies[getSessionCookieName()];
  if (sessionId) {
    const data = await authenticateSession(db, sessionId);
    if (data) {
      req.authUser = data.user;
      req.authSession = data.session;
      reply.setCookie(getSessionCookieName(), sessionId, {
        ...COOKIE_OPTIONS,
        expires: data.session.expiresAt,
      });
    } else {
      reply.clearCookie(getSessionCookieName());
    }
    return;
  }

  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    const rawToken = authHeader.slice('Bearer '.length);

    if (adminBearer && isAdminToken(rawToken, adminBearer.token)) {
      req.authServiceAccount = { id: adminBearer.serviceAccountId, tenantId: adminBearer.tenantId };
      return;
    }

    // Cross-platform JWTs minted by XTM One (agent tool calls running as a
    // real user, matched by email). Tokens with a JWT shape try this path
    // first; when it does not authenticate, resolution falls through to the
    // other bearer schemes (service-account tokens never contain
    // dots today, but the fallthrough keeps them order-independent).
    if (looksLikeJwt(rawToken)) {
      const xtmAuth = await authenticateXtmOneJwt(db, rawToken);
      if (xtmAuth) {
        req.authUser = xtmAuth.user;
        req.authSession = {
          id: XTM_ONE_SESSION_ID,
          userId: xtmAuth.user.id,
          expiresAt: xtmAuth.expiresAt,
        };
        return;
      }
    }

    const result = await authenticateServiceAccountToken(db, rawToken);
    if (result) {
      req.authServiceAccount = { id: result.serviceAccountId, tenantId: result.tenantId };
    }
  }
};

export const createContext = (db: DrizzleDB) => {
  const resolveAuth = resolveRequestAuth(db);
  return async ({ req, res }: CreateFastifyContextOptions) => {
    await resolveAuth(req, res);
    const tenantIdHeader = req.headers['x-tenant-id'];
    const tenantId = Array.isArray(tenantIdHeader) ? tenantIdHeader[0] : tenantIdHeader;
    return { req, res, user: req.authUser, session: req.authSession, serviceAccount: req.authServiceAccount, tenantId };
  };
};

export type TRPCContext = Awaited<ReturnType<ReturnType<typeof createContext>>>;

export interface ProcedureMeta {
  /**
   * The tables a query's result takes from the request context or from process memory, which no
   * statement of the call reads: without it, the doorbells name such a query on every change. Added
   * to the tables the call is observed reading, so `[]` narrows a query to those alone. Tables
   * rather than names, so a typo or a renamed table fails to compile instead of leaving the query on
   * no doorbell.
   */
  reads?: ReadonlyArray<PgTable>,
}

export const trpcInstance = initTRPC.context<TRPCContext>().meta<ProcedureMeta>().create({
  sse: {
    // Ping often and reconnect after a short silence so a silently-dead stream (a dropped socket
    // the browser never reports as an error) is detected in ~10-20s instead of lingering as a
    // `pending`-but-stale connection. The client surfaces the inactivity timeout as a reconnect,
    // which drives both the desync banner and the on-reconnect cache resync.
    ping: { enabled: true, intervalMs: 10_000 },
    client: { reconnectAfterInactivityMs: 20_000 },
  },
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? z.treeifyError(error.cause) : null,
        reason: error.cause instanceof StructuredError ? error.cause.reason : null,
      },
      message: error.code === 'INTERNAL_SERVER_ERROR' ? 'Internal Server Error' : shape.message,
    };
  },
});

export const router = trpcInstance.router;

// Only queries are observed: a mutation's reads decide nothing a client caches.
const instrumentedProcedure = trpcInstance.procedure.use(({ path, type, meta, next }) =>
  instrumentTrpcCall(path, type, type === 'query' ? () => observeQueryProcedure(path, next, meta?.reads?.map((table) => getTableName(table))) : next, { maxResponseItems }));

export const publicProcedure = instrumentedProcedure.use(({ ctx, next }) => next({ ctx: { user: ctx.user } }));
export type PublicProcedure = typeof publicProcedure;

/** The single place a request's tenant context is decided: everything downstream reads the origin, never the header. */
const userOrigin = (userId: string, tenantId: string | undefined): UserOrigin =>
  (tenantId ? { type: 'client', userId, tenantId } : { type: 'platform', userId });

export const protectedProcedure = instrumentedProcedure.use(({ ctx, next }) => {
  if (!ctx.user || !ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  const origin = userOrigin(ctx.user.id, ctx.tenantId);
  return next({
    ctx: { user: ctx.user, tenantId: ctx.tenantId, session: ctx.session, serviceAccount: ctx.serviceAccount, origin },
  });
});
export type ProtectedProcedure = typeof protectedProcedure;

/**
 * Accepts user+session auth OR service account Bearer token auth.
 * Use this as the base for API procedures that must support both.
 */
export const authenticatedProcedure = instrumentedProcedure.use(({ ctx, next }) => {
  const hasUserAuth = !!(ctx.user && ctx.session);
  const hasServiceAccountAuth = !!ctx.serviceAccount;

  if (!hasUserAuth && !hasServiceAccountAuth) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  const tenantId = hasServiceAccountAuth ? ctx.serviceAccount!.tenantId : ctx.tenantId;
  const origin: UserOrigin | ConnectorOrigin = hasServiceAccountAuth
    ? { type: 'connector', serviceAccountId: ctx.serviceAccount!.id, tenantId: ctx.serviceAccount!.tenantId }
    : userOrigin(ctx.user!.id, tenantId);

  return next({ ctx: { user: ctx.user, tenantId, serviceAccount: ctx.serviceAccount, origin } });
});

/**
 * Rejects a caller that provided no tenant, so a router built on this one can never reach a query
 * whose isolation predicate needs a tenant the request did not carry. The default for API routers;
 * only the platform surface opts out.
 */
export const tenantScopedProcedure = authenticatedProcedure.use(({ ctx, next }) => {
  if (ctx.origin.type === 'platform') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Missing x-tenant-id header' });
  }
  return next({ ctx: { ...ctx, origin: ctx.origin, tenantId: ctx.origin.tenantId } });
});
