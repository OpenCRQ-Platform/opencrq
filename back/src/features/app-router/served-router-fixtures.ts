import type { DrizzleDB } from '@app/module';
import { authService, createServices, notificationsService, tenantsService } from '@app/module';
import { newError } from '@app/utils';
import { protectedProcedure, publicProcedure, trpcInstance } from '../../trpc';
import { authServiceRouter } from '../auth-service/auth-service-router';
import { editionRootRouter } from '../edition/edition-router';
import { createDataChangedHub } from '../events/data-changed-hub';
import { eventsRouter } from '../events/events-router';
import { xtmOneRootRouter } from '../xtm-one/xtm-one-router';
import { appRouter } from './app-router-router';

// The roots `types/trpc-router.ts` merges into the type clients call `/trpc` with.
export const servedRouter = () => {
  const db: DrizzleDB = Object.create(null);
  return trpcInstance.mergeRouters(
    appRouter({ publicProcedure }, db),
    authServiceRouter({ publicProcedure, protectedProcedure }, createServices([authService, notificationsService, tenantsService], db)),
    editionRootRouter(protectedProcedure),
    eventsRouter({ protectedProcedure }, db, createDataChangedHub({ windowMs: 0, jobWindowMs: 0 }), new AbortController().signal, () => {
      throw newError('No doorbell rings while the manifest is described');
    }),
    xtmOneRootRouter(protectedProcedure),
  );
};
