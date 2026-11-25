import { newError } from '@app/utils';
import type { CounterpartKind, CounterpartProduct, CounterpartProvider, XtmCounterpart } from './xtm-counterpart-utils';
import { isHttpUrl, isRecord, normaliseCounterpartKey, sanitiseFacts } from './xtm-counterpart-utils';

/**
 * The providers OpenCRQ resolves counterparts with, built from the URLs of the connections it
 * already holds (`connectors.opencti.<tenant>` and `connectors.openaev.<tenant>`). A lookup runs for
 * one reader and authenticates as that reader (`authorization`: a short-lived JWT XTM One signs for
 * them): the product applies the reader's own rights, and the connector
 * token, which reads everything the sync reads, is never sent on a reader's behalf. No identity for
 * the reader, or a refusal, gives no counterpart.
 */

// OpenAEV's default tenant (io.openaev.database.model.Tenant.DEFAULT_TENANT_UUID), the one a
// single-tenant OpenAEV serves; OpenCTI reaches OpenAEV the same way.
export const OPENAEV_DEFAULT_TENANT_ID = '2cffad3a-0001-4078-b0e2-ef74274022c3';
const LOOKUP_TIMEOUT_MS = 5_000;

export interface ProductConnection { url: string, token: string }

export type ReaderProduct = 'opencti' | 'openaev';

/**
 * The bearer of one reader for the product behind `connection`; `null` when this platform cannot
 * sign for the reader (no user session, no XTM One), which `unsigned` names.
 */
export type ReaderAuthorization = ((product: ReaderProduct, connection: ProductConnection) => Promise<string | null>) & { readonly unsigned?: string };

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const trimSlash = (url: string) => url.replace(/\/+$/, '');

/** An answer that is not the shape the product documents is a failed lookup, not an empty one. */
const malformedAnswer = () => newError('XTM counterpart lookup failed', { answer: 'malformed' });

const postJson = async (fetchImpl: FetchLike, url: string, bearer: string, body: unknown): Promise<unknown> => {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!res.ok) {
    // Never the request in the message: its headers carry the token.
    throw newError('XTM counterpart lookup failed', { status: res.status });
  }
  return res.json();
};

// -- OpenAEV: its reverse lookup (OpenAEV-Platform/openaev#9393, POST /xtm/objects/{kind}) --

const OPENAEV_PATHS: Partial<Record<CounterpartKind, string>> = {
  ASSET: 'assets',
  ATTACK_PATTERN: 'attack-patterns',
  VULNERABILITY: 'vulnerabilities',
  THREAT: 'threats',
};

export const openaevProvider = (
  connection: ProductConnection | undefined,
  authorization: ReaderAuthorization,
  fetchImpl: FetchLike = fetch,
): CounterpartProvider => ({
  product: 'openaev',
  url: connection ? trimSlash(connection.url) : null,
  isConnected: !!connection?.url && !!connection.token,
  supports: (kind) => kind in OPENAEV_PATHS,
  resolve: async (kind, keys) => {
    const path = OPENAEV_PATHS[kind];
    if (!connection || !path) {
      return [];
    }
    const bearer = await authorization('openaev', connection);
    if (!bearer) {
      return [];
    }
    const url = `${trimSlash(connection.url)}/api/tenants/${OPENAEV_DEFAULT_TENANT_ID}/xtm/objects/${path}`;
    const data = await postJson(fetchImpl, url, bearer, { counterpart_keys: keys });
    if (!Array.isArray(data)) {
      throw malformedAnswer();
    }
    return toCounterparts('openaev', kind, keys, data);
  },
});

// -- XTM One: its CTEM inventory (XTM-One-Platform/xtm-one#1349, POST /api/v1/organization-context/assets/lookup) --

export const XTM_ONE_LOOKUP_PATH = '/api/v1/organization-context/assets/lookup';

/**
 * The headers of one reader's call to XTM One (their short-lived JWT addressed to XTM One's
 * identity, and this platform's `X-Platform-*`); `null` when this platform cannot sign for them.
 */
export type XtmOneReaderHeaders = () => Promise<Record<string, string> | null>;

/** The XTM One facts the preview shows, read from the inventory asset when it holds them. */
const XTM_ONE_FACTS = ['criticality', 'category'] as const;

/**
 * Finds our assets in the inventory of the XTM One this deployment is connected to (`xtm_one.url`),
 * with the reader's own XTM One account: what it answers is what that reader may read there. XTM
 * One's inventory holds assets only. Its answer is `{ items: [{ key, id, name, category,
 * criticality, url, ... }] }`, the key echoed as asked.
 */
export const xtmOneProvider = (
  xtmOneUrl: string | null,
  headers: XtmOneReaderHeaders,
  fetchImpl: FetchLike = fetch,
): CounterpartProvider => ({
  product: 'xtmone',
  url: xtmOneUrl ? trimSlash(xtmOneUrl) : null,
  isConnected: !!xtmOneUrl,
  supports: (kind) => kind === 'ASSET',
  resolve: async (kind, keys) => {
    if (!xtmOneUrl || kind !== 'ASSET' || keys.length === 0) {
      return [];
    }
    const readerHeaders = await headers();
    if (!readerHeaders) {
      return [];
    }
    const res = await fetchImpl(`${trimSlash(xtmOneUrl)}${XTM_ONE_LOOKUP_PATH}`, {
      method: 'POST',
      headers: { ...readerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys }),
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Never the request in the message: its headers carry the reader's token.
      throw newError('XTM One asset lookup failed', { status: res.status });
    }
    const answer: unknown = await res.json();
    if (!isRecord(answer) || !Array.isArray(answer.items)) {
      throw malformedAnswer();
    }
    return toCounterparts('xtmone', kind, keys, answer.items.filter(isRecord).map((item) => ({
      object_key: item.key,
      object_id: item.id,
      object_type: 'asset',
      object_name: typeof item.name === 'string' ? item.name : null,
      object_url: item.url,
      object_facts: XTM_ONE_FACTS.flatMap((fact) => {
        const value = item[fact];
        return typeof value === 'string' && value !== '' ? [{ key: fact, value }] : [];
      }),
    })));
  },
});

const toCounterparts = (
  product: CounterpartProduct,
  kind: CounterpartKind,
  asked: ReadonlyArray<string>,
  objects: ReadonlyArray<Record<string, unknown>>,
): Array<XtmCounterpart> => {
  const wanted = new Set(asked);
  const out: Array<XtmCounterpart> = [];
  for (const o of objects) {
    const key = normaliseCounterpartKey(kind, typeof o?.object_key === 'string' ? o.object_key : null);
    if (!key || !wanted.has(key) || typeof o.object_id !== 'string' || !isHttpUrl(o.object_url)) {
      continue;
    }
    out.push({
      key,
      product,
      objectId: o.object_id,
      objectType: typeof o.object_type === 'string' ? o.object_type : kind.toLowerCase(),
      objectName: typeof o.object_name === 'string' ? o.object_name : null,
      objectUrl: o.object_url,
      facts: sanitiseFacts(o.object_facts),
    });
  }
  return out;
};

// -- OpenCTI: its GraphQL API, the same endpoint OpenCRQ already calls to list Live Streams --

const OPENCTI_LOOKUP_QUERY = `
  query XtmCounterparts($types: [String], $filters: FilterGroup, $first: Int) {
    stixCoreObjects(types: $types, filters: $filters, first: $first) {
      edges { node { id standard_id entity_type representative { main } ... on AttackPattern { x_mitre_id } ... on Vulnerability { name } } }
    }
  }
`;

interface OpenctiLookup { types: Array<string>, filterKey: string, keyOf: (node: Record<string, unknown>) => unknown }

const OPENCTI_LOOKUPS: Partial<Record<CounterpartKind, OpenctiLookup>> = {
  THREAT: {
    types: ['Intrusion-Set', 'Threat-Actor', 'Malware', 'Campaign'],
    filterKey: 'standard_id',
    keyOf: (node) => node.standard_id,
  },
  ATTACK_PATTERN: { types: ['Attack-Pattern'], filterKey: 'x_mitre_id', keyOf: (node) => node.x_mitre_id },
  VULNERABILITY: { types: ['Vulnerability'], filterKey: 'name', keyOf: (node) => node.name },
  ASSET: {
    types: ['System', 'Hostname'],
    filterKey: 'name',
    keyOf: (node) => representativeMain(node),
  },
};

const representativeMain = (node: Record<string, unknown>): unknown => (isRecord(node.representative) ? node.representative.main : undefined);

/**
 * The nodes of a `stixCoreObjects` answer, read field by field: the answer is not trusted. GraphQL
 * refuses with a 200 whose `errors` say so, which is a failed lookup, never an empty one.
 */
const openctiNodes = (answer: unknown): Array<Record<string, unknown>> => {
  const data = isRecord(answer) && isRecord(answer.data) ? answer.data : undefined;
  const connection = data && isRecord(data.stixCoreObjects) ? data.stixCoreObjects : undefined;
  const refused = isRecord(answer) && Array.isArray(answer.errors) && answer.errors.length > 0;
  if (refused || !connection || !Array.isArray(connection.edges)) {
    throw malformedAnswer();
  }
  return connection.edges.flatMap((edge: unknown) => (isRecord(edge) && isRecord(edge.node) ? [edge.node] : []));
};

/** The URL a browser opens the product on, which links to its objects are built from. */
export type PublicProductUrl = (connection: ProductConnection) => Promise<string>;

export const openctiProvider = (
  connection: ProductConnection | undefined,
  authorization: ReaderAuthorization,
  fetchImpl: FetchLike = fetch,
  publicUrl: PublicProductUrl = (c) => Promise.resolve(trimSlash(c.url)),
): CounterpartProvider => ({
  product: 'opencti',
  url: connection ? trimSlash(connection.url) : null,
  isConnected: !!connection?.url && !!connection.token,
  supports: (kind) => kind in OPENCTI_LOOKUPS,
  resolve: async (kind, keys) => {
    const lookup = OPENCTI_LOOKUPS[kind];
    if (!connection || !lookup) {
      return [];
    }
    const base = trimSlash(connection.url);
    const bearer = await authorization('opencti', connection);
    if (!bearer) {
      return [];
    }
    const data = await postJson(fetchImpl, `${base}/graphql`, bearer, {
      query: OPENCTI_LOOKUP_QUERY,
      variables: {
        types: lookup.types,
        first: keys.length,
        filters: { mode: 'and', filterGroups: [], filters: [{ key: [lookup.filterKey], values: keys, operator: 'eq', mode: 'or' }] },
      },
    });
    const nodes = openctiNodes(data);
    // The calls above go to the connection's address; a link is opened from a browser.
    const linkBase = nodes.length > 0 ? trimSlash(await publicUrl(connection)) : base;
    return toCounterparts('opencti', kind, keys, nodes.map((node) => ({
      object_key: lookup.keyOf(node),
      object_id: node.id,
      object_type: typeof node.entity_type === 'string' ? node.entity_type : undefined,
      object_name: representativeMain(node),
      object_url: typeof node.id === 'string' ? `${linkBase}/dashboard/id/${encodeURIComponent(node.id)}` : null,
    })));
  },
});
