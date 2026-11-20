import { openctiConnectorSettings } from '@app/module';
import { TRPCError } from '@trpc/server';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import type { DescribedStream } from './opencti-stream-filter-utils';
import { isOriginAuthorizedForItsTenant } from '../tenant-access-utils';
import { config } from '../../../config';
import { router } from '../../../trpc';
import { createLogger } from '../../../utils/logger';
import { computeTimelineProgressPercent } from './opencti-backfill-progress-utils';
import { describeStreams, STREAM_RELATIONSHIPS, STREAM_VERDICTS, streamFilterGroupSchema } from './opencti-stream-filter-utils';

const { logWarn } = createLogger({ feature: 'opencti' });

const OpenctiConnectorSettingsSchema = createSelectSchema(openctiConnectorSettings);

const STREAM_COLLECTIONS_QUERY = `
  query StreamCollections {
    streamCollections {
      edges {
        node { id name description filters origin_filters stream_live }
      }
    }
  }
`;

const streamCollectionsResponseSchema = z.object({
  data: z.object({
    streamCollections: z.object({
      edges: z.array(z.object({
        node: z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable().optional(),
          filters: z.string().nullable().optional(),
          origin_filters: z.string().nullable().optional(),
          stream_live: z.boolean().nullable().optional(),
        }),
      })),
    }),
  }),
});

/**
 * Lists the OpenCTI Live Streams the deployment's token can see, via the GraphQL API: used to
 * populate the stream picker in the Configure form. Separate from the SSE consumption path
 * (`opencti-sse-client.ts`), which only ever connects to one already-chosen stream.
 */
const fetchOpenCtiStreams = async (url: string, token: string): Promise<Array<DescribedStream>> => {
  const res = await fetch(`${url.replace(/\/$/, '')}/graphql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: STREAM_COLLECTIONS_QUERY }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: `OpenCTI GraphQL auth error (${res.status})` });
  }
  const body = await res.text();
  if (res.status === 429) {
    // The HTTP hook traces every 4xx as the caller's refusal; this one is OpenCTI's own state.
    logWarn('OpenCTI GraphQL rate-limited the stream listing', { status: res.status });
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: `OpenCTI GraphQL rate-limited the request (${res.status})` });
  }
  if (res.status >= 500) {
    throw new TRPCError({ code: 'BAD_GATEWAY', message: `OpenCTI GraphQL error: ${res.status} — ${body.slice(0, 300)}` });
  }
  if (!res.ok) {
    // Anything else 4xx (malformed URL, unknown route, etc.) is a deployment config issue, not OpenCTI's own server failing.
    throw new TRPCError({ code: 'BAD_REQUEST', message: `OpenCTI GraphQL error: ${res.status} — ${body.slice(0, 300)}` });
  }
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    // Not `PARSE_ERROR` (that code means the tRPC request itself was malformed, mapped to HTTP 400): this is OpenCTI's response failing to parse, still a `BAD_GATEWAY`.
    throw new TRPCError({ code: 'BAD_GATEWAY', message: `OpenCTI GraphQL returned non-JSON response: ${body.slice(0, 300)}` });
  }
  const parsed = streamCollectionsResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new TRPCError({ code: 'BAD_GATEWAY', message: `OpenCTI GraphQL returned an unexpected response shape: ${body.slice(0, 300)}` });
  }
  return describeStreams(parsed.data.data.streamCollections.edges.map(({ node }) => node));
};

export const openctiRouter = (procedure: TenantProcedure) => router({
  getSettings: procedure
    .output(OpenctiConnectorSettingsSchema.nullable())
    .query(async ({ ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      return services.withOrigin(origin).openctiConnector.getSettings(origin.tenantId);
    }),

  // bounded-by: the Live Streams an OpenCTI admin configured, read from that instance's API
  listStreams: procedure
    .output(z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      rawFilter: z.string().nullable(),
      filterGroup: streamFilterGroupSchema.nullable(),
      verdict: z.enum(STREAM_VERDICTS),
      missingRelationships: z.array(z.enum(STREAM_RELATIONSHIPS)),
      replaysHistory: z.boolean(),
    })))
    .query(async ({ ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      // A client's tenantId is unchecked `x-tenant-id`, unlike a connector's, already bound to its
      // own service account's tenant — without this, a client could read another tenant's live
      // OpenCTI token and use it to list that tenant's streams.
      if (!(await isOriginAuthorizedForItsTenant(origin, (t) => services.withOrigin(origin).tenants.callerReachesTenant(t)))) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const openctiConfig = config().connectors?.opencti?.[origin.tenantId];
      if (!openctiConfig) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'OpenCTI is not configured for this tenant.' });
      }
      try {
        return await fetchOpenCtiStreams(openctiConfig.url, openctiConfig.token);
      } catch (err) {
        // Same token authenticates both this listing call and the Live Stream SSE connection:
        // if it's rejected here, the tenant's own connector (if enabled) is equally dead and would
        // otherwise keep retrying forever with no visible signal on the Settings page.
        if (err instanceof TRPCError && err.code === 'UNAUTHORIZED' && origin.tenantId) {
          const settings = await services.withOrigin(origin).openctiConnector.getSettings(origin.tenantId);
          if (settings?.enabled) {
            await services.withOrigin(origin).openctiConnector.markAuthFailed(origin.tenantId);
          }
        }
        throw err;
      }
    }),

  configure: procedure
    .input(z.object({
      serviceAccountId: z.uuid(),
      streamId: z.string().min(1),
    }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const canManage = await services.withOrigin(origin).capabilities.hasManageSecurity();
      if (!canManage) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const serviceAccount = await services.withOrigin(origin).serviceAccounts.getServiceAccount(input.serviceAccountId);
      if (!serviceAccount) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Service account not found' });
      }
      await services.withOrigin(origin).openctiConnector.configure(
        origin.tenantId,
        input.serviceAccountId,
        input.streamId,
      );
    }),

  setEnabled: procedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const canManage = await services.withOrigin(origin).capabilities.hasManageSecurity();
      if (!canManage) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      await services.withOrigin(origin).openctiConnector.setEnabled(origin.tenantId, input.enabled);
    }),

  getBackfillProgress: procedure
    .output(z.object({
      mirroredObjectCount: z.number(),
      isCatchingUp: z.boolean(),
      progressPercent: z.number().nullable(),
    }))
    .query(async ({ ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const [mirroredObjectCount, settings] = await Promise.all([
        services.withOrigin(origin).openctiConnector.countStreamObjects(origin.tenantId),
        services.withOrigin(origin).openctiConnector.getSettings(origin.tenantId),
      ]);
      // `reachedLiveTailAt` is a permanent latch (see `opencti-connector-manager.ts`): once set, a
      // later quiet live period can never make this look like we're catching up again.
      const isCatchingUp = !!settings?.enabled && !settings.reachedLiveTailAt;
      const progressPercent = computeTimelineProgressPercent({
        historyStartAt: settings?.historyStartAt ?? null,
        backfillTargetAt: settings?.backfillTargetAt ?? null,
        currentEventAt: settings?.lastEventAt ?? null,
      });
      return { mirroredObjectCount, isCatchingUp, progressPercent };
    }),
});
