import { initTRPC } from '@trpc/server';
import type { AppRouter } from '../features/app-router/app-router-router';
import type { AuthRouter } from '../features/auth-service/auth-service-router';
import type { EditionRootRouter } from '../features/edition/edition-router';
import type { EventsRouter } from '../features/events/events-router';
import type { XtmOneRootRouter } from '../features/xtm-one/xtm-one-router';

const t = initTRPC.create();

declare const appRouter: AppRouter;
declare const authRouter: AuthRouter;
declare const editionRouter: EditionRootRouter;
declare const eventsRouter: EventsRouter;
declare const xtmOneRouter: XtmOneRootRouter;

export const trpcRouter = t.mergeRouters(appRouter, authRouter, editionRouter, eventsRouter, xtmOneRouter);

export type TRPCRouter = typeof trpcRouter;
