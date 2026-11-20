import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { AnyTRPCRouter } from '@trpc/server';
import type { FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import type { FastifyInstance } from 'fastify';
import { fastify } from 'fastify';
import type { ProtectedProcedure, PublicProcedure, router } from '../../trpc';
import { config } from '../../config';
import { createContext, protectedProcedure, publicProcedure, scopeSessionCookieToPort, setMaxResponseItems, trpcInstance } from '../../trpc';
import { createLogger } from '../../utils/logger';
import { dbEngine } from '../db';
import { registerEngine } from '../engines-manager';
import { registerClientErrorsRoute } from './client-errors-route';
import { registerResponseCompression } from './response-compression';
import { logTrpcError } from './trpc-error-logging';

const HTTP_SERVER_ENGINE_KEY = 'http-server';

// Shared upper bound for any multipart upload route (e.g. STIX bundle upload, XTM One chat
// upload). Registered once globally so features never need to (re-)register the plugin
// themselves — @fastify/multipart has no guard against double registration and throws
// FST_ERR_DEC_ALREADY_PRESENT if registered twice on the same Fastify instance.
const MULTIPART_MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const MULTIPART_MAX_FILES = 10;

const logger = createLogger({ engine: HTTP_SERVER_ENGINE_KEY });
const { logTrace, logFromFatalError } = logger;

// Deferred server setup (routes, static serving) collected during feature activation and
// applied to the Fastify instance at the start of Phase 2. The raw server never leaves the
// engine — features describe what to mount through the curated httpServerEngine verbs.
const serverRegistrars: Array<(server: FastifyInstance) => void> = [];
const routeDefinitions: Array<ReturnType<typeof router>> = [];

// The router `/trpc` serves, merged once the engines have started; `null` before, and in a process
// that serves no HTTP.
let servedRouter: AnyTRPCRouter | null = null;

// Public engine API — the curated verbs consumers may touch, via httpServerEngine.
const startHttpServerEngine = async () => {
  const httpServerConfig = config().http_server;
  if (!httpServerConfig) {
    logTrace('HTTP server engine disabled: no http_server config');
    return {};
  }

  scopeSessionCookieToPort(httpServerConfig.port);
  setMaxResponseItems(httpServerConfig.max_response_items);

  const server = fastify({ routerOptions: { maxParamLength: 5000 } });

  server.register(cors, {
    origin: /^http:\/\/localhost:\d+$/,
    credentials: true,
  });

  server.register(cookie, {
    hook: 'onRequest',
  });

  // Registered once globally (see MULTIPART_MAX_FILE_SIZE_BYTES) so any feature route can
  // consume req.file()/req.files() without registering the plugin itself.
  server.register(multipart, {
    limits: { fileSize: MULTIPART_MAX_FILE_SIZE_BYTES, files: MULTIPART_MAX_FILES },
  });

  server.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  });

  await registerResponseCompression(server);

  // Request decorators and the static, registration-independent routes are set up here in
  // start(): they depend on nothing that features/engines register, so they need no barrier.
  server.decorateRequest('authUser', null);
  server.decorateRequest('authSession', null);
  server.decorateRequest('authResolved', false);

  // -- Disable crawling and search engine indexing of the whole platform.
  // Applied as a global header in addition to the <meta name="robots"> tag
  // injected in index.html and the dedicated /robots.txt and /sitemap.xml routes.
  server.addHook('onSend', (_req, reply, _payload, done) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
    done();
  });

  server.get('/robots.txt', (_req, reply) => {
    reply.type('text/plain');
    reply.header('Cache-Control', 'public, max-age=86400');
    reply.send('User-agent: *\nDisallow: /\n');
  });

  server.get('/sitemap.xml', (_req, reply) => {
    reply.type('application/xml');
    reply.header('Cache-Control', 'public, max-age=86400');
    reply.send('<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');
  });

  const onEnginesStarted = async (): Promise<void> => {
    // Not registered in start() like the other static routes: it needs the DB engine to resolve
    // the optional session auth.
    registerClientErrorsRoute(server, dbEngine.db);
    serverRegistrars.forEach((register) => register(server));

    const appRouter = trpcInstance.mergeRouters(...routeDefinitions);
    servedRouter = appRouter;
    server.register(fastifyTRPCPlugin, {
      prefix: '/trpc',
      trpcOptions: {
        router: appRouter,
        createContext: createContext(dbEngine.db),
        onError({ path, error }) {
          logTrpcError(logger, error, path);
        },
      } satisfies FastifyTRPCPluginOptions<typeof appRouter>['trpcOptions'],
    });

    try {
      const address = await server.listen({ port: httpServerConfig.port, host: httpServerConfig.host });
      const publicPort = httpServerConfig.public_port;
      logTrace(`Server listening at ${address}`);
      if (publicPort && publicPort !== httpServerConfig.port) {
        logTrace(`Server public port: ${publicPort}`);
      }
    } catch (error) {
      logFromFatalError(error, 'Failed to start server');
    }
  };

  return { onEnginesStarted };
};

export const httpServerEngine = registerEngine({
  key: HTTP_SERVER_ENGINE_KEY,
  start: startHttpServerEngine,
  api: {
    getServedRouter: (): AnyTRPCRouter | null => servedRouter,
  },
  registrationApi: {
    registerRouter: (routerDefinition: (procedures: { publicProcedure: PublicProcedure, protectedProcedure: ProtectedProcedure }) => ReturnType<typeof router>): void => {
      routeDefinitions.push(routerDefinition({ protectedProcedure, publicProcedure }));
    },
    // Plain (non-tRPC) HTTP routes - e.g. the XTM One JWKS endpoint and the
    // embedded-chat proxy, which must speak SSE / multipart / binary. The
    // registrar runs at the start of Phase 2, before the server listens.
    registerHttpRoutes: (registrar: (server: FastifyInstance) => void): void => {
      serverRegistrars.push(registrar);
    },
    registerSPA: (opts: { root: string }): void => {
      serverRegistrars.push((server) => {
        server.register(fastifyStatic, { root: opts.root });
        server.setNotFoundHandler((_req, reply) => {
          reply.sendFile('index.html');
        });
      });
    },
  },
});
