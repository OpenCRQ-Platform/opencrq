import { newError } from '@app/utils';
import type { CounterpartKind, CounterpartProvider, XtmCounterpart } from './xtm-counterpart-utils';
import { isHttpUrl, isRecord, normaliseCounterpartKey, sanitiseFacts } from './xtm-counterpart-utils';

/**
 * The providers OpenCRQ resolves counterparts with, built from the connections it already holds
 * (`connectors.opencti.<tenant>` and `connectors.openaev.<tenant>`): no second connection model,
 * and the tokens never leave the server.
 */

// OpenAEV's default tenant (io.openaev.database.model.Tenant.DEFAULT_TENANT_UUID), the one a
// single-tenant OpenAEV serves; OpenCTI reaches OpenAEV the same way.
export const OPENAEV_DEFAULT_TENANT_ID = '2cffad3a-0001-4078-b0e2-ef74274022c3';
const LOOKUP_TIMEOUT_MS = 5_000;

export interface ProductConnection { url: string, token: string }

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const trimSlash = (url: string) => url.replace(/\/+$/, '');

const postJson = async (fetchImpl: FetchLike, url: string, token: string, body: unknown): Promise<unknown> => {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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

export const openaevProvider = (connection: ProductConnection | undefined, fetchImpl: FetchLike = fetch): CounterpartProvider => ({
  product: 'openaev',
  url: connection ? trimSlash(connection.url) : null,
  isConnected: !!connection?.url && !!connection.token,
  supports: (kind) => kind in OPENAEV_PATHS,
  resolve: async (kind, keys) => {
    const path = OPENAEV_PATHS[kind];
    if (!connection || !path) {
      return [];
    }
    const url = `${trimSlash(connection.url)}/api/tenants/${OPENAEV_DEFAULT_TENANT_ID}/xtm/objects/${path}`;
    const data = await postJson(fetchImpl, url, connection.token, { counterpart_keys: keys });
    return toCounterparts('openaev', kind, keys, Array.isArray(data) ? data : []);
  },
});

const toCounterparts = (
  product: 'openaev' | 'opencti',
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

/** The nodes of a `stixCoreObjects` answer, read field by field: the answer is not trusted. */
const openctiNodes = (answer: unknown): Array<Record<string, unknown>> => {
  const data = isRecord(answer) && isRecord(answer.data) ? answer.data : undefined;
  const connection = data && isRecord(data.stixCoreObjects) ? data.stixCoreObjects : undefined;
  const edges = connection && Array.isArray(connection.edges) ? connection.edges : [];
  return edges.flatMap((edge: unknown) => (isRecord(edge) && isRecord(edge.node) ? [edge.node] : []));
};

export const openctiProvider = (connection: ProductConnection | undefined, fetchImpl: FetchLike = fetch): CounterpartProvider => ({
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
    const data = await postJson(fetchImpl, `${base}/graphql`, connection.token, {
      query: OPENCTI_LOOKUP_QUERY,
      variables: {
        types: lookup.types,
        first: keys.length,
        filters: { mode: 'and', filterGroups: [], filters: [{ key: [lookup.filterKey], values: keys, operator: 'eq', mode: 'or' }] },
      },
    });
    const nodes = openctiNodes(data);
    return toCounterparts('opencti', kind, keys, nodes.map((node) => ({
      object_key: lookup.keyOf(node),
      object_id: node.id,
      object_type: typeof node.entity_type === 'string' ? node.entity_type : undefined,
      object_name: representativeMain(node),
      object_url: typeof node.id === 'string' ? `${base}/dashboard/id/${encodeURIComponent(node.id)}` : null,
    })));
  },
});
