import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import type { CounterpartProvider } from './xtm-counterpart-utils';
import { isOriginAuthorizedForItsTenant } from '../tenant-access-utils';
import { config } from '../../../config';
import { router } from '../../../trpc';
import { getXtmOneSettings } from '../../xtm-one/xtm-one-config';
import { COUNTERPART_KINDS, MAX_COUNTERPART_KEYS, resolveCounterparts, XTM_PRODUCTS, xtmConnections } from './xtm-counterpart-utils';
import { lookupXtmObjects, XTM_LOOKUP_KINDS } from './xtm-lookup';
import { openaevProvider, openctiProvider } from './xtm-providers';

/** The providers of one tenant, from the connections its deployment already configures. */
export const tenantProviders = (tenantId: string): Array<CounterpartProvider> => {
  const connectors = config().connectors;
  return [
    openctiProvider(connectors?.opencti?.[tenantId]),
    openaevProvider(connectors?.openaev?.[tenantId]),
  ];
};

const connectionSchema = z.object({
  product: z.enum(XTM_PRODUCTS),
  connected: z.boolean(),
  url: z.string().nullable(),
});

const counterpartSchema = z.object({
  key: z.string(),
  product: z.enum(XTM_PRODUCTS),
  objectId: z.string(),
  objectType: z.string(),
  objectName: z.string().nullable(),
  objectUrl: z.string(),
  facts: z.array(z.object({ key: z.string(), value: z.string() })),
});

const lookupObjectSchema = z.object({
  object_key: z.string(),
  object_id: z.string(),
  object_type: z.string(),
  object_name: z.string().nullable(),
  object_url: z.string(),
  object_facts: z.array(z.object({ key: z.string(), value: z.string() })),
});

/**
 * Cross-product awareness: which XTM products this tenant reaches, and which of their objects are
 * the same as ours. Never carries a credential; a client's `x-tenant-id` is checked against the
 * tenants it reaches before the tenant's connections are read.
 */
type TenantOrigin = Parameters<typeof isOriginAuthorizedForItsTenant>[0];

const authorizedTenant = async (origin: TenantOrigin, callerReachesTenant: (tenantId: string) => Promise<boolean>): Promise<string> => {
  if (!origin.tenantId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  if (!(await isOriginAuthorizedForItsTenant(origin, callerReachesTenant))) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return origin.tenantId;
};

export const xtmRouter = (procedure: TenantProcedure) => router({
  // bounded-by: XTM_PRODUCTS, one row per product this tenant can reach
  connections: procedure
    .output(z.array(connectionSchema))
    .query(async ({ ctx: { services, origin } }) => xtmConnections(tenantProviders(
      await authorizedTenant(origin, (t) => services.withOrigin(origin).tenants.callerReachesTenant(t)),
    ))),

  // bounded-by: MAX_COUNTERPART_KEYS keys per call, one lookup per connected product
  counterparts: procedure
    .input(z.object({
      kind: z.enum(COUNTERPART_KINDS),
      keys: z.array(z.string().max(512)).max(MAX_COUNTERPART_KEYS),
    }))
    .output(z.array(counterpartSchema))
    .query(async ({ input, ctx: { services, origin } }) => {
      const tenantId = await authorizedTenant(origin, (t) => services.withOrigin(origin).tenants.callerReachesTenant(t));
      return resolveCounterparts(tenantId, input.kind, input.keys, tenantProviders(tenantId));
    }),

  // bounded-by: MAX_COUNTERPART_KEYS keys per call, one batched read of one kind
  // eslint-disable-next-line app/no-unused-router-endpoint -- OpenCTI and OpenAEV call it with a service-account token, the UI does not
  lookup: procedure
    .input(z.object({
      kind: z.enum(XTM_LOOKUP_KINDS),
      keys: z.array(z.string().max(512)).max(MAX_COUNTERPART_KEYS),
    }))
    .output(z.array(lookupObjectSchema))
    .query(async ({ input, ctx: { services, origin } }) => {
      const tenantId = await authorizedTenant(origin, (t) => services.withOrigin(origin).tenants.callerReachesTenant(t));
      const baseUrl = getXtmOneSettings()?.platformUrl;
      if (!baseUrl) {
        return [];
      }
      const scoped = services.withOrigin(origin);
      return lookupXtmObjects({ kind: input.kind, keys: input.keys, baseUrl, tenantId }, {
        threatsByStixIds: (stixIds) => scoped.threatAnalyses.getByStixIds(stixIds),
        cvesByCveIds: (cveIds) => scoped.cve.getCvesByCveIds(cveIds),
        assetsByHostnames: (hostnames) => scoped.supportingAssets.getByHostnames(hostnames),
        exposure: (kind, objectIds) => scoped.crqIndicators.getXtmExposure(kind, objectIds),
      });
    }),
});
