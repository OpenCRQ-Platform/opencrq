import type { authService, createServices, notificationsService, tenantsService } from '@app/module';
import { schema } from '@app/module';
import type { Edition } from '../edition';
import type { ProtectedProcedure, PublicProcedure } from '../../trpc';
import { getSessionCookieName, router } from '../../trpc';
import { enabledFeatureFlags } from '../feature-flags/feature-flags';

export const authServiceRouter = (
  { publicProcedure, protectedProcedure }: { publicProcedure: PublicProcedure, protectedProcedure: ProtectedProcedure },
  services: ReturnType<typeof createServices<[typeof authService, typeof notificationsService, typeof tenantsService]>>,
  // Injected by the feature (see auth-service-feature.ts) so the router stays
  // engine-free: the platform edition rides on the bootstrap payload, which is
  // the one query the frontend already makes before login. Awaited rather than read outright, so an early request is
  // not answered from a not-yet-resolved entitlement. Defaults to Community
  // Edition when the edition feature is not activated in this process.
  resolveEdition: () => Promise<Edition> = () => Promise.resolve('ce'),
  // Whether XTM One can sign anyone in now: a browser with no session goes there, or is told it is unavailable.
  isXtmSignInAvailable: () => Promise<boolean> = () => Promise.resolve(false),
) => router({
  // A revoked session closes the event stream itself, so `sessions` is left out.
  isLoggedIn: publicProcedure.meta({ reads: [schema.users] }).query(({ ctx }) => {
    if (!ctx.user) {
      return null;
    }
    return {
      id: ctx.user.id,
      email: ctx.user.email,
      name: ctx.user.name,
      title: ctx.user.title,
      // The browser renews a session through XTM One on a navigation shortly before it ends, so
      // no form is lost to a redirect mid-edit. A duration, not a date: the browser's clock may not
      // be the server's.
      sessionExpiresInMs: ctx.session ? ctx.session.expiresAt.getTime() - Date.now() : null,
      renewsThroughXtmOne: ctx.user.xtmSubject !== null,
    };
  }),
  authStatus: publicProcedure.query(async () => ({
    featureFlags: enabledFeatureFlags(),
    edition: await resolveEdition(),
    xtmSignIn: await isXtmSignInAvailable(),
  })),
  signOut: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.session) {
      await services.withOrigin({ type: 'auth' })
        .auth.invalidateSession(ctx.session.id);
    }
    ctx.res.clearCookie(getSessionCookieName());
    return { success: true };
  }),
  getMe: protectedProcedure.meta({ reads: [schema.users] }).query(({ ctx }) => ({ id: ctx.user.id, email: ctx.user.email, name: ctx.user.name, title: ctx.user.title })),
});

export type AuthRouter = ReturnType<typeof authServiceRouter>;
