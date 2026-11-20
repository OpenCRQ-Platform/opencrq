import cookie from '@fastify/cookie';
import type { DrizzleDB } from '@app/module';
import {
  authService,
  createServices,
  notificationsService,
  tenantsService,
} from '@app/module';
import type { AnyTRPCRouter } from '@trpc/server';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { fastify } from 'fastify';
import { appRouter } from '@app/back/src/features/app-router/app-router-router';
import { createServedProcedureManifest } from '@app/back/src/features/app-router/procedure-manifest';
import { authServiceRouter } from '@app/back/src/features/auth-service/auth-service-router';
import { getEdition, grantRemoteEntitlement, whenEditionResolved } from '@app/back/src/features/edition';
import { createContext, protectedProcedure, publicProcedure, trpcInstance } from '@app/back/src/trpc';

/**
 * Multi-tenancy is an Enterprise Edition feature, and most of this suite gives
 * its users a tenant of their own on top of the seeded one - a shape a
 * Community deployment refuses. The test platform is therefore entitled by
 * default, through the same remote grant a verified XTM One answer records,
 * and a suite that exercises Community behaviour asks for it explicitly.
 */
export const setTestEdition = (edition: 'ce' | 'ee'): void => {
  grantRemoteEntitlement(edition === 'ee' ? Number.POSITIVE_INFINITY : 0, null, null);
};

export const createTestApp = async (db: DrizzleDB) => {
  const server = fastify({ routerOptions: { maxParamLength: 5000 } });

  await server.register(cookie, {
    hook: 'onRequest',
  });

  const authServices = createServices([authService, notificationsService, tenantsService], db);
  setTestEdition('ee');
  const resolveEdition = async () => {
    await whenEditionResolved();
    return getEdition();
  };
  const authRouter = authServiceRouter({ publicProcedure, protectedProcedure }, authServices, resolveEdition);
  // The manifest describes the router served below, which needs the main router built first.
  let servedRouter: AnyTRPCRouter | null = null;
  const procedureManifest = createServedProcedureManifest(() => servedRouter);
  const mainRouter = appRouter({ publicProcedure }, db, undefined, undefined, procedureManifest);
  const fullRouter = trpcInstance.mergeRouters(authRouter, mainRouter);
  servedRouter = fullRouter;

  await server.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: fullRouter,
      createContext: createContext(db),
    },
  });

  await server.ready();
  return server;
};
