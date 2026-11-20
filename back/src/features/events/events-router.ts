import { createServices, tenantsService } from '@app/module';
import type { DrizzleDB } from '@app/module';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { ProtectedProcedure } from '../../trpc';
import type { DataChangedHub } from './data-changed-hub';
import type { DoorbellResolver } from './doorbell-resolver';
import { router, sessionExpirySignal } from '../../trpc';

// Per-user cap on concurrent event streams - a product policy; the hub only counts - avoid ddos.
const MAX_CONNECTIONS_PER_USER = 100;

/**
 * Exposes a single SSE subscription, `events.onDataChanged`, that acts as a cache-invalidation
 * doorbell: it yields whenever data the user can see changes, naming the query procedures the
 * change made stale so the client refetches those and nothing else, or `all` when the change
 * cannot be named (a LISTEN reconnect).
 */
export const eventsRouter = (
  { protectedProcedure }: { protectedProcedure: ProtectedProcedure },
  db: DrizzleDB,
  hub: DataChangedHub,
  shutdownSignal: AbortSignal,
  resolveDoorbell: DoorbellResolver,
) => {
  const services = createServices([tenantsService], db);

  return router({
    events: router({
      onDataChanged: protectedProcedure
        .input(z.object({ tenantId: z.uuid().nullable() }))
        .subscription(async function* onDataChanged({ ctx, input, signal }) {
          const userId = ctx.user.id;

          // The stream's tenant is its input, not the request's header, so the tenants policy is asked
          // for that tenant from the user's tenant-less origin.
          if (input.tenantId
            && !(await services.withOrigin({ type: 'platform', userId }).tenants.callerReachesTenant(input.tenantId))) {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this tenant' });
          }

          if (!hub.reserve(userId, MAX_CONNECTIONS_PER_USER)) {
            throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many event-stream connections' });
          }

          // The stream authenticates once at connect, so bind its lifetime to the session two ways:
          // a single timer that fires at the session's fixed expiry (the backstop: it alone catches
          // plain expiry), and an immediate push when this session is invalidated (logout) via the
          // hub's session_revoked LISTEN. A NOTIFY dropped during a LISTEN reconnect is recovered by
          // the reconcile sweep wired in the events feature's onListening.
          const sessionRevoked = new AbortController();
          const { signal: expired, dispose: stopExpiryTimer } = sessionExpirySignal(ctx.session.expiresAt);
          const unwatch = hub.watchSession(ctx.session.id, () => sessionRevoked.abort());

          try {
            // A tenant-scoped stream still receives global doorbells; an empty set receives only those.
            const tenantIds = input.tenantId ? [input.tenantId] : [];

            // Ends when the client disconnects, the server shuts down, the re-check fails, or the
            // session is revoked, whichever comes first.
            const lifetime = AbortSignal.any(
              [signal, shutdownSignal, expired, sessionRevoked.signal].filter((s): s is AbortSignal => s !== undefined),
            );
            for await (const event of hub.subscribe({ tenantIds, signal: lifetime })) {
              // Built rather than forwarded: the subscription declares no output schema, so
              // anything left on the event would reach the client.
              const { procedures, all } = resolveDoorbell(event);
              yield { tenantId: event.tenantId, procedures, all };
            }
          } finally {
            stopExpiryTimer();
            unwatch();
            hub.release(userId);
          }
        }),
    }),
  });
};

export type EventsRouter = ReturnType<typeof eventsRouter>;
