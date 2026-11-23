import type { DrizzleDB, OpenctiThreatVisibility } from '@app/module';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { AuthUser } from '../../../trpc';
import type { TenantProcedure } from '../app-router-router';
import type { CounterpartProvider } from './xtm-counterpart-utils';
import type { ProductConnection, ReaderAuthorization, XtmOneReaderHeaders } from './xtm-providers';
import { isOriginAuthorizedForItsTenant } from '../tenant-access-utils';
import { config } from '../../../config';
import { router } from '../../../trpc';
import { outsideObservedCall } from '../../events/query-dependency-index';
import { authenticateXtmOneJwt } from '../../xtm-one/xtm-one-auth';
import { getXtmOneSettings } from '../../xtm-one/xtm-one-config';
import { buildXtmOneHeaders } from '../../xtm-one/xtm-one-headers';
import { readerTokenExchange, ReaderTokenUnavailable } from '../../xtm-one/xtm-one-token-exchange';
import { COUNTERPART_KINDS, COUNTERPART_PRODUCTS, MAX_COUNTERPART_KEYS, resolveCounterparts, switcherProducts, XTM_PRODUCTS, xtmConnections } from './xtm-counterpart-utils';
import { openctiPublicUrl } from './opencti-public-url';
import { lookupXtmObjects,resolveLookupFactsOrigin, XTM_LOOKUP_KINDS, XTM_USER_TOKEN_HEADER } from './xtm-lookup';
import { openaevProvider, openctiProvider, xtmOneProvider } from './xtm-providers';

/** An authorization with no reader identity to sign, and why: a lookup made with it reaches nothing. */
const signsNothing = (unsigned: string): ReaderAuthorization => Object.assign(() => Promise.resolve(null), { unsigned });
const NO_READER = signsNothing('no user to sign for');
const NO_XTM_ONE = signsNothing('XTM One is not configured');

/**
 * The bearer a sibling product reads with on behalf of one OpenCRQ user: a short-lived JWT XTM One
 * signs for that user, addressed to the product (`readerTokenExchange`), which the product verifies
 * against XTM One's `GET /xtm/auth/jwks` and resolves to its own user by email. `null` without a user
 * (a service account or a connector never pivots) or without XTM One.
 *
 * XTM One addresses a token only to the URL a product registered: OpenCTI's is the one its settings
 * name (`openctiPublicUrl`); OpenAEV's is taken to be the connector URL.
 */
export const readerAuthorization = (db: DrizzleDB, user: AuthUser | null | undefined): ReaderAuthorization => {
  const settings = getXtmOneSettings();
  if (!user) {
    return NO_READER;
  }
  if (!settings) {
    return NO_XTM_ONE;
  }
  const identity = { id: user.id, email: user.email, name: user.name };
  return async (product, connection) => {
    const audience = product === 'opencti' ? await openctiPublicUrl.resolve(connection) : connection.url;
    return readerTokenExchange.exchange(settings, () => buildXtmOneHeaders(settings, db, identity), user.id, audience);
  };
};

/**
 * The bearer OpenCTI is asked a member's scope with: the member's own (`readerAuthorization`), or
 * the connector token once the tenant chose `service_account`, so every member reads what the
 * connector reads. The choice is read only when a scope is, outside the call that asked: it is
 * kept with the scope in the process, not in anything a doorbell refreshes.
 */
export const readerScopeAuthorization = (
  db: DrizzleDB,
  user: AuthUser | null | undefined,
  threatVisibility: () => Promise<OpenctiThreatVisibility>,
): ReaderAuthorization => {
  const reader = readerAuthorization(db, user);
  const authorization: ReaderAuthorization = async (product, connection) => (
    await outsideObservedCall(threatVisibility) === 'service_account' ? connection.token : reader(product, connection)
  );
  return reader.unsigned === undefined ? authorization : Object.assign(authorization, { unsigned: reader.unsigned });
};

export const READER_LINKS = ['linked', 'not_linked', 'unknown'] as const;

/**
 * Whether OpenCTI can be asked as one of this platform's members: `not_linked` only when XTM One
 * names OpenCTI's URL as no platform registered with it, so no member token can ever reach it;
 * `unknown` for any other failure, which says nothing about how OpenCTI is wired.
 */
export const probeReaderLink = async (
  authorization: ReaderAuthorization,
  connection: ProductConnection,
): Promise<typeof READER_LINKS[number]> => {
  if (authorization.unsigned !== undefined) {
    return 'unknown';
  }
  try {
    return (await authorization('opencti', connection)) ? 'linked' : 'unknown';
  } catch (err) {
    return err instanceof ReaderTokenUnavailable && err.refusal === 'audience' ? 'not_linked' : 'unknown';
  }
};

/** No reader to sign for XTM One: its lookup reaches nothing. */
const NO_XTM_ONE_READER: XtmOneReaderHeaders = () => Promise.resolve(null);

/**
 * The headers one OpenCRQ user calls XTM One with (their short-lived JWT, as the chat proxy
 * sends); `null` without a user (a service account or a connector never pivots).
 */
export const xtmOneReaderHeaders = (db: DrizzleDB, user: AuthUser | null | undefined): XtmOneReaderHeaders => {
  const settings = getXtmOneSettings();
  if (!user || !settings) {
    return NO_XTM_ONE_READER;
  }
  return () => buildXtmOneHeaders(settings, db, { id: user.id, email: user.email, name: user.name });
};

/**
 * The providers of one tenant in the emblem order (XTM One, OpenCTI, OpenAEV), from the connections
 * its deployment already configures. Their lookups authenticate as the reader they sign for, never
 * with a connector token.
 */
export const tenantProviders = (
  tenantId: string,
  authorization: ReaderAuthorization = NO_READER,
  xtmOneHeaders: XtmOneReaderHeaders = NO_XTM_ONE_READER,
): Array<CounterpartProvider> => {
  const connectors = config().connectors;
  return [
    xtmOneProvider(getXtmOneSettings()?.url ?? null, xtmOneHeaders),
    openctiProvider(connectors?.opencti?.[tenantId], authorization),
    openaevProvider(connectors?.openaev?.[tenantId], authorization),
  ];
};

const connectionSchema = z.object({
  product: z.enum(COUNTERPART_PRODUCTS),
  connected: z.boolean(),
  url: z.string().nullable(),
});

const counterpartSchema = z.object({
  key: z.string(),
  product: z.enum(COUNTERPART_PRODUCTS),
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

  // bounded-by: COUNTERPART_PRODUCTS, one row per product this tenant can reach
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
      return resolveCounterparts(tenantId, user.id, input.kind, input.keys, tenantProviders(tenantId, readerAuthorization(db, user), xtmOneReaderHeaders(db, user)));
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
