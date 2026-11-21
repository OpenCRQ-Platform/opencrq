import type { DrizzleDB } from '@app/module';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { AuthUser } from '../../../trpc';
import type { TenantProcedure } from '../app-router-router';
import type { CounterpartProvider } from './xtm-counterpart-utils';
import type { ReaderAuthorization } from './xtm-providers';
import { isOriginAuthorizedForItsTenant } from '../tenant-access-utils';
import { config } from '../../../config';
import { router } from '../../../trpc';
import { authenticateXtmOneJwt } from '../../xtm-one/xtm-one-auth';
import { getXtmOneSettings } from '../../xtm-one/xtm-one-config';
import { issueUserJwt } from '../../xtm-one/xtm-one-jwt';
import { ensureSigningKey } from '../../xtm-one/xtm-one-keys';
import { COUNTERPART_KINDS, MAX_COUNTERPART_KEYS, resolveCounterparts, switcherProducts, XTM_PRODUCTS, xtmConnections } from './xtm-counterpart-utils';
import { lookupXtmObjects, resolveLookupFactsOrigin, XTM_LOOKUP_KINDS, XTM_USER_TOKEN_HEADER } from './xtm-lookup';
import { openaevProvider, openctiProvider } from './xtm-providers';

/** No reader identity to sign: a lookup made with it reaches nothing. */
const NO_READER: ReaderAuthorization = () => Promise.resolve(null);

/**
 * The bearer a sibling product reads with on behalf of one OpenCRQ user: a short-lived JWT this
 * platform signs for that user (issuer: this platform's public URL, audience: the product's URL),
 * which the product verifies against `GET /xtm/auth/jwks` and resolves to its own user by email.
 * `null` without a user (a service account or a connector never pivots) or without a public URL.
 */
export const readerAuthorization = (db: DrizzleDB, user: AuthUser | null | undefined): ReaderAuthorization => {
  const issuer = getXtmOneSettings()?.platformUrl;
  if (!user || !issuer) {
    return NO_READER;
  }
  return async (productUrl) => {
    const material = await ensureSigningKey(db);
    return issueUserJwt(material, issuer, productUrl, { id: user.id, email: user.email, name: user.name });
  };
};

/**
 * The providers of one tenant, from the connections its deployment already configures. Their
 * lookups authenticate as the reader `authorization` signs for, never with a connector token.
 */
export const tenantProviders = (tenantId: string, authorization: ReaderAuthorization = NO_READER): Array<CounterpartProvider> => {
  const connectors = config().connectors;
  return [
    openctiProvider(connectors?.opencti?.[tenantId], authorization),
    openaevProvider(connectors?.openaev?.[tenantId], authorization),
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

export const xtmRouter = (procedure: TenantProcedure, db: DrizzleDB) => router({
  // bounded-by: XTM_PRODUCTS, one row per sibling product
  // eslint-disable-next-line app/no-unused-router-endpoint -- the product switcher of the header (opencrq #8) reads it
  products: procedure
    .output(z.array(z.object({ product: z.enum(XTM_PRODUCTS), url: z.string().nullable() })))
    .query(async ({ ctx: { services, origin } }) => switcherProducts(
      config().xtm,
      tenantProviders(await authorizedTenant(origin, (t) => services.withOrigin(origin).tenants.callerReachesTenant(t))),
    )),

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
    .query(async ({ input, ctx: { services, origin, user } }) => {
      const tenantId = await authorizedTenant(origin, (t) => services.withOrigin(origin).tenants.callerReachesTenant(t));
      if (!user) {
        // Only a person pivots, with their own rights in the sibling product.
        return [];
      }
      return resolveCounterparts(tenantId, user.id, input.kind, input.keys, tenantProviders(tenantId, readerAuthorization(db, user)));
    }),

  // bounded-by: MAX_COUNTERPART_KEYS keys per call, one batched read of one kind
  // eslint-disable-next-line app/no-unused-router-endpoint -- OpenCTI and OpenAEV call it with a service-account token (and the XTM One user token), the UI does not
  lookup: procedure
    .input(z.object({
      kind: z.enum(XTM_LOOKUP_KINDS),
      keys: z.array(z.string().max(512)).max(MAX_COUNTERPART_KEYS),
    }))
    .output(z.array(lookupObjectSchema))
    .query(async ({ input, ctx: { services, origin, req } }) => {
      const tenantId = await authorizedTenant(origin, (t) => services.withOrigin(origin).tenants.callerReachesTenant(t));
      const baseUrl = getXtmOneSettings()?.platformUrl;
      if (!baseUrl) {
        return [];
      }
      const scoped = services.withOrigin(origin);
      // A person reads the facts with their own rights; a service account gets the link only
      // (opencrq #26), unless it forwards a token XTM One signed for a person of its tenant: then
      // the facts are read as that person (opencrq F4 part 2). Never logged: it is a credential.
      const tokenHeader = req.headers[XTM_USER_TOKEN_HEADER];
      const factsOrigin = await resolveLookupFactsOrigin(origin, Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader, {
        authenticate: (token) => authenticateXtmOneJwt(db, token),
        reachesTenant: (userId, t) => services.withOrigin({ type: 'client', userId, tenantId: t }).tenants.callerReachesTenant(t),
      });
      const factsReader = factsOrigin ? services.withOrigin(factsOrigin) : null;
      return lookupXtmObjects({ kind: input.kind, keys: input.keys, baseUrl, tenantId, withFacts: factsReader !== null }, {
        threatsByStixIds: (stixIds) => scoped.threatAnalyses.getByStixIds(stixIds),
        cvesByCveIds: (cveIds) => scoped.cve.getCvesByCveIds(cveIds),
        assetsByHostnames: (hostnames) => scoped.supportingAssets.getByHostnames(hostnames),
        exposure: (kind, objectIds) => (factsReader ? factsReader.crqIndicators.getXtmExposure(kind, objectIds) : Promise.resolve(new Map())),
      });
    }),
});
