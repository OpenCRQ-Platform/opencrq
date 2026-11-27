import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 1_000;
/** The JSON names of OpenAEV's `@Queryable(sortable = true)` `Asset` fields: any other sort property is a 400. */
const SORTABLE_ASSET_PROPERTIES = new Set([
  'asset_name', 'asset_description', 'asset_external_reference', 'asset_category', 'asset_subcategory',
  'asset_criticality', 'asset_internet_facing', 'asset_cloud_provider', 'asset_cloud_native_type',
  'asset_cloud_region', 'asset_seen_ip', 'asset_hostname', 'asset_url', 'ai_target_provider',
  'ai_target_endpoint', 'ai_target_model', 'ai_target_modality', 'asset_status',
]);
/** Stamped on the `updated_at` of the first document, then one second per write. */
const CLOCK_ORIGIN_MS = Date.UTC(2026, 9, 1);

export interface FakeAttackDocument {
  id: string,
  updated_at: string,
  asset_id: string,
  scenario_id: string,
  scenario_name: string | null,
  last_simulation_id: string | null,
  last_simulation_name: string | null,
  last_simulation_start_date: string | null,
  last_simulation_status: string,
  last_inject_id: string | null,
  attack_pattern_external_id: string,
  attack_pattern_name: string,
  expectation_type: string,
  expectation_status: string,
  attempts_total: number,
  attempts_success: number,
  coverage_ratio: number,
  platforms_reporting: Array<string> | null,
  platforms_succeeded: Array<string>,
  platform_types_reporting: Array<string>,
  platform_types_succeeded: Array<string>,
  last_verified_at: string,
  asset_name: string,
  endpoint_hostname: string | null,
  endpoint_platform: string | null,
  tenant_name: string,
}

export interface FakeVulnerabilityDocument {
  id: string,
  updated_at: string,
  asset_id: string,
  last_finding_id: string | null,
  last_scenario_id: string | null,
  last_scenario_name: string | null,
  last_simulation_id: string | null,
  last_simulation_name: string | null,
  finding_type: string,
  finding_value: string,
  vulnerability_external_id: string,
  last_verified_at: string,
  asset_name: string,
  endpoint_hostname: string | null,
  endpoint_platform: string | null,
  tenant_name: string,
}

/** An asset that is not an endpoint: only `GET /assets/{id}` serves its description. */
export interface FakeGenericAsset {
  id: string,
  name: string,
  /** The `asset_category` the inventory reports it under, e.g. `saas_application`. */
  category: string,
  description: string | null,
  url?: string | null,
  /** An OpenAEV user id, as OpenAEV serves it; the name comes from the tenant's users (`setUsers`). */
  linkedPerson?: string | null,
  /** The OpenAEV marking ids `asset_markings` carries; resolved to STIX ids through `setMarkingDefinitions`. */
  markings?: Array<string>,
}

export interface FakeUser {
  id: string,
  firstName: string,
  lastName: string,
  email: string,
}

/** The counts the posture widget serves for one asset. */
export interface FakePostureCounts {
  success: number,
  failed: number,
}

export interface FakeEndpoint {
  id: string,
  name: string,
  hostname: string,
  /** Served by `/endpoints/find`: two endpoints sharing a hostname and a MAC address are one machine to the matcher. */
  macAddresses?: Array<string>,
  /** The OpenAEV marking ids `asset_markings` carries; resolved to STIX ids through `setMarkingDefinitions`. */
  markings?: Array<string>,
}

/** One definition `GET /marking_definitions/assignable` serves. */
export interface FakeMarkingDefinition {
  id: string,
  type: string,
  definition: string,
  order?: number | null,
  stixId?: string | null,
}

/** What `GET /api/settings/public` answers. */
export interface FakePublicSettings {
  status: number,
  body: unknown,
}

/** What a test says about one attack document; the rest of the wire shape is filled in. */
export interface AttackDocumentInput {
  assetId: string,
  scenarioId: string,
  /** MITRE external id, e.g. `T1003`. */
  technique: string,
  expectationType?: 'DETECTION' | 'PREVENTION',
  simulationId: string,
  simulationStartDate: Date | null,
  status?: string,
  /** Platform types that reported a verdict, and the ones whose verdict is a success. */
  reporting: ReadonlyArray<string>,
  succeeded?: ReadonlyArray<string>,
  verifiedAt: Date,
}

export interface VulnerabilityDocumentInput {
  assetId: string,
  cve: string,
  verifiedAt: Date,
}

/** The id OpenAEV derives from the tenant, asset, technique, type and scenario: one document per such tuple. */
const attackDocumentId = (tenantId: string, input: AttackDocumentInput): string =>
  createHash('md5')
    .update([tenantId, input.assetId, input.technique, input.expectationType ?? 'DETECTION', input.scenarioId].join('|'))
    .digest('hex');

const vulnerabilityDocumentId = (tenantId: string, input: VulnerabilityDocumentInput): string =>
  createHash('md5').update([tenantId, input.assetId, 'CVE', input.cve].join('|')).digest('hex');

interface CursorPosition {
  updatedAt: string,
  id: string,
}

const encodeCursor = (position: CursorPosition): string => Buffer.from(JSON.stringify(position)).toString('base64url');

const decodeCursor = (cursor: string): CursorPosition | null => {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (isRecord(parsed) && typeof parsed['updatedAt'] === 'string' && typeof parsed['id'] === 'string') {
      return { updatedAt: parsed['updatedAt'], id: parsed['id'] };
    }
  } catch {
    // Falls through to the invalid cursor answer.
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The asset ids a posture widget request asks about: the values of its `base_asset_side` filter. */
const postureAssetIdsOf = (request: unknown): Array<string> => {
  const config = isRecord(request) ? request['widget_config'] : undefined;
  const series = isRecord(config) && Array.isArray(config['series']) ? config['series'] : [];
  const filter = isRecord(series[0]) ? series[0]['filter'] : undefined;
  const filters = isRecord(filter) && Array.isArray(filter['filters']) ? filter['filters'] : [];
  const assetSide = filters.find((candidate) => isRecord(candidate) && candidate['key'] === 'base_asset_side');
  const values = isRecord(assetSide) ? assetSide['values'] : undefined;
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
};

const assetSortPropertiesOf = (request: unknown): Array<string> => {
  const sorts = isRecord(request) && Array.isArray(request['sorts']) ? request['sorts'] : [];
  return sorts.flatMap((sort) => (isRecord(sort) && typeof sort['property'] === 'string' ? [sort['property']] : []));
};

/** The values of an `/assets/search` request's `asset_id` filter, `null` when it carries none. */
const assetIdFilterOf = (request: unknown): Array<string> | null => {
  const group = isRecord(request) ? request['filterGroup'] : undefined;
  const filters = isRecord(group) && Array.isArray(group['filters']) ? group['filters'] : [];
  const idFilter = filters.find((candidate) => isRecord(candidate) && candidate['key'] === 'asset_id');
  const values = isRecord(idFilter) ? idFilter['values'] : undefined;
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : null;
};

const compareDocuments = (a: CursorPosition, b: CursorPosition): number => {
  if (a.updatedAt !== b.updatedAt) {
    return a.updatedAt < b.updatedAt ? -1 : 1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
};

/**
 * One snapshot stream: documents served in `(updated_at, id)` order behind an opaque cursor, the
 * way the real route does. A document is added, replaced (which moves it to the tail of the order)
 * or removed (with no tombstone) between two runs.
 */
export interface FakeSnapshotStream<Doc extends { id: string, updated_at: string }> {
  put: (doc: Omit<Doc, 'updated_at'>) => void,
  remove: (id: string) => void,
  has: (id: string) => boolean,
  /** `snapshot_ready` of every page served. */
  ready: boolean,
  /** Caps the page size below what the client asks for, to force several pages. */
  maxPageSize: number,
  /** Answers every request with this HTTP status instead of a page, until set back to `null`. */
  failWith: number | null,
}

interface SnapshotAnswer {
  status: number,
  body: unknown,
}

const createSnapshotStream = <Doc extends { id: string, updated_at: string }>(
  nextTimestamp: () => string,
): { stream: FakeSnapshotStream<Doc>, answer: (request: unknown) => SnapshotAnswer } => {
  const documents = new Map<string, Doc>();
  const stream: FakeSnapshotStream<Doc> = {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `updated_at` is the one key `Omit` removed, and is stamped here
    put: (doc) => documents.set(doc.id, { ...doc, updated_at: nextTimestamp() } as Doc),
    remove: (id) => documents.delete(id),
    has: (id) => documents.has(id),
    ready: true,
    maxPageSize: MAX_PAGE_SIZE,
    failWith: null,
  };

  const answer = (request: unknown): SnapshotAnswer => {
    if (stream.failWith !== null) {
      return { status: stream.failWith, body: { message: 'snapshot stream unavailable' } };
    }
    const body = isRecord(request) ? request : {};
    const cursor = typeof body['cursor'] === 'string' ? body['cursor'] : null;
    if (cursor !== null && 'since' in body) {
      return { status: 400, body: { message: 'cursor and since are mutually exclusive' } };
    }
    const after = cursor === null ? null : decodeCursor(cursor);
    if (cursor !== null && after === null) {
      return { status: 400, body: { message: 'invalid cursor' } };
    }
    const requested = typeof body['page_size'] === 'number' ? body['page_size'] : DEFAULT_PAGE_SIZE;
    const pageSize = Math.max(1, Math.min(requested, MAX_PAGE_SIZE, stream.maxPageSize));

    const ordered = [...documents.values()]
      .filter((doc) => after === null || compareDocuments({ updatedAt: doc.updated_at, id: doc.id }, after) > 0)
      .sort((a, b) => compareDocuments({ updatedAt: a.updated_at, id: a.id }, { updatedAt: b.updated_at, id: b.id }));
    const page = ordered.slice(0, pageSize);
    const last = page.at(-1);
    return {
      status: 200,
      body: {
        observations: page,
        // An empty page hands back the cursor it was sent, `null` when it was sent none.
        next_cursor: last === undefined ? cursor : encodeCursor({ updatedAt: last.updated_at, id: last.id }),
        // A full last page still claims more: the next one is then empty.
        has_more: page.length === pageSize,
        snapshot_window_end: new Date(CLOCK_ORIGIN_MS).toISOString(),
        indexed_through: new Date(CLOCK_ORIGIN_MS).toISOString(),
        server_time: new Date().toISOString(),
        consistency_mode: 'eventual',
        snapshot_ready: stream.ready,
      },
    };
  };

  return { stream, answer };
};

export interface FakeOpenaevTenant {
  id: string,
  name: string,
  /** Replaces the tenant's inventory: every endpoint is served by `/assets/search` and `/endpoints/find`. */
  setEndpoints: (endpoints: Array<FakeEndpoint>) => void,
  /** Replaces the tenant's generic assets: listed by `/assets/search`, described by `GET /assets/{id}`, and unknown (404) once removed. */
  setGenericAssets: (assets: Array<FakeGenericAsset>) => void,
  /** Replaces the users `POST /users/find` answers for. */
  setUsers: (users: Array<FakeUser>) => void,
  /** Replaces what `GET /marking_definitions/assignable` serves; until it is called the route is unknown (404), as on an OpenAEV without it. */
  setMarkingDefinitions: (markings: Array<FakeMarkingDefinition>) => void,
  /** Caps the page size an unfiltered `/assets/search` serves below what the client asks for, to force several pages. */
  assetPageSize: number,
  /** Called once an unfiltered `/assets/search` has served a page, with its index: changing the inventory there changes it during a read. */
  onAssetPage: ((page: number) => void) | null,
  /** Replaces what `POST /dashboards/adhoc/series` serves, by asset id: an asset with no entry has no bucket, as when OpenAEV never measured it. */
  setPosture: (counts: Record<string, FakePostureCounts>) => void,
  /** Makes the posture widget answer with this HTTP status instead of its counts. */
  setPostureStatus: (status: number) => void,
  attack: FakeSnapshotStream<FakeAttackDocument>,
  vulnerability: FakeSnapshotStream<FakeVulnerabilityDocument>,
  /** Puts the attack document the input describes, and returns its id. */
  putAttack: (input: AttackDocumentInput) => string,
  putVulnerability: (input: VulnerabilityDocumentInput) => string,
  /** The id the stream gives the document of this input, whether or not it is currently served. */
  attackIdOf: (input: AttackDocumentInput) => string,
  vulnerabilityIdOf: (input: VulnerabilityDocumentInput) => string,
}

export interface FakeOpenaevRequest {
  method: string,
  /** The path below the base URL, with the OpenAEV tenant id replaced by `{tenant}`. */
  route: string,
  tenantId: string | null,
  body: unknown,
  /** The `cursor` of a snapshot request body, `null` when it carries none. */
  cursor: string | null,
}

export interface FakeOpenaev {
  url: string,
  token: string,
  addTenant: (id: string, name: string) => FakeOpenaevTenant,
  /** Replaces the answer of `GET /api/settings/public`; until it is called the route is unknown (404), as on an OpenAEV that predates it. */
  setPublicSettings: (settings: FakePublicSettings) => void,
  /** Every request received, in order, except the probes. */
  requests: Array<FakeOpenaevRequest>,
  /** The probes received: a snapshot request for a single observation, with which the connector checks that the route exists. */
  probes: Array<FakeOpenaevRequest>,
  /** The requests received on one route, for one OpenAEV tenant when given. */
  requestsTo: (method: string, route: string, tenantId?: string) => Array<FakeOpenaevRequest>,
  close: () => Promise<void>,
}

const TOKEN = 'fake-openaev-token';
const TENANT_ROUTE = /^\/api\/tenants\/([^/]+)(\/.*)$/;

const readBody = (chunks: Array<Buffer>): unknown => {
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? null : JSON.parse(text);
};

/**
 * An OpenAEV instance in memory, on a free port: the tenant list, a minimal inventory (endpoints
 * and generic assets), the two snapshot streams with their opaque cursors and the posture widget. A real
 * socket rather than a `fetch` double, so the connector's own request building and response parsing
 * are what a test exercises.
 */
export const startFakeOpenaev = (): Promise<FakeOpenaev> => {
  const tenants = new Map<string, { tenant: FakeOpenaevTenant, answerPosture: (request: unknown) => SnapshotAnswer, endpoints: () => Array<FakeEndpoint>, genericAssets: () => Array<FakeGenericAsset>, users: () => Array<FakeUser>, markingDefinitions: () => Array<FakeMarkingDefinition> | null, answerAttack: (request: unknown) => SnapshotAnswer, answerVulnerability: (request: unknown) => SnapshotAnswer }>();
  const requests: Array<FakeOpenaevRequest> = [];
  const probes: Array<FakeOpenaevRequest> = [];
  let tick = 0;
  const nextTimestamp = () => {
    tick += 1;
    return new Date(CLOCK_ORIGIN_MS + tick * 1000).toISOString();
  };

  const addTenant = (id: string, name: string): FakeOpenaevTenant => {
    let endpoints: Array<FakeEndpoint> = [];
    let genericAssets: Array<FakeGenericAsset> = [];
    let users: Array<FakeUser> = [];
    let markingDefinitions: Array<FakeMarkingDefinition> | null = null;
    let posture: Record<string, FakePostureCounts> = {};
    let postureStatus = 200;
    const attack = createSnapshotStream<FakeAttackDocument>(nextTimestamp);
    const vulnerability = createSnapshotStream<FakeVulnerabilityDocument>(nextTimestamp);
    const endpointOf = (assetId: string) => endpoints.find((endpoint) => endpoint.id === assetId);
    const tenant: FakeOpenaevTenant = {
      id,
      name,
      setEndpoints: (next) => {
        endpoints = next;
      },
      setGenericAssets: (next) => {
        genericAssets = next;
      },
      setMarkingDefinitions: (next) => {
        markingDefinitions = next;
      },
      setUsers: (next) => {
        users = next;
      },
      assetPageSize: Number.POSITIVE_INFINITY,
      onAssetPage: null,
      setPosture: (next) => {
        posture = next;
      },
      setPostureStatus: (status) => {
        postureStatus = status;
      },
      attack: attack.stream,
      vulnerability: vulnerability.stream,
      attackIdOf: (input) => attackDocumentId(id, input),
      vulnerabilityIdOf: (input) => vulnerabilityDocumentId(id, input),
      putAttack: (input) => {
        const endpoint = endpointOf(input.assetId);
        const documentId = attackDocumentId(id, input);
        attack.stream.put({
          id: documentId,
          asset_id: input.assetId,
          scenario_id: input.scenarioId,
          scenario_name: `Scenario ${input.scenarioId}`,
          last_simulation_id: input.simulationId,
          last_simulation_name: `Simulation ${input.simulationId}`,
          last_simulation_start_date: input.simulationStartDate?.toISOString() ?? null,
          last_simulation_status: input.status ?? 'FINISHED',
          last_inject_id: `inject-${input.technique}`,
          attack_pattern_external_id: input.technique,
          attack_pattern_name: input.technique,
          expectation_type: input.expectationType ?? 'DETECTION',
          expectation_status: (input.succeeded ?? []).length > 0 ? 'SUCCESS' : 'FAILED',
          attempts_total: input.reporting.length,
          attempts_success: (input.succeeded ?? []).length,
          coverage_ratio: input.reporting.length === 0 ? 0 : (input.succeeded ?? []).length / input.reporting.length,
          platforms_reporting: null,
          platforms_succeeded: [],
          platform_types_reporting: [...input.reporting],
          platform_types_succeeded: [...(input.succeeded ?? [])],
          last_verified_at: input.verifiedAt.toISOString(),
          asset_name: endpoint?.name ?? input.assetId,
          endpoint_hostname: endpoint?.hostname ?? null,
          endpoint_platform: 'Linux',
          tenant_name: name,
        });
        return documentId;
      },
      putVulnerability: (input) => {
        const endpoint = endpointOf(input.assetId);
        const documentId = vulnerabilityDocumentId(id, input);
        vulnerability.stream.put({
          id: documentId,
          asset_id: input.assetId,
          last_finding_id: `finding-${input.cve}`,
          last_scenario_id: null,
          last_scenario_name: null,
          last_simulation_id: null,
          last_simulation_name: null,
          finding_type: 'CVE',
          finding_value: input.cve,
          vulnerability_external_id: input.cve,
          last_verified_at: input.verifiedAt.toISOString(),
          asset_name: endpoint?.name ?? input.assetId,
          endpoint_hostname: endpoint?.hostname ?? null,
          endpoint_platform: 'Linux',
          tenant_name: name,
        });
        return documentId;
      },
    };
    const answerPosture = (request: unknown): SnapshotAnswer => {
      if (postureStatus !== 200) {
        return { status: postureStatus, body: { message: 'posture widget unavailable' } };
      }
      const requested = postureAssetIdsOf(request);
      const buckets = (field: keyof FakePostureCounts) => Object.entries(posture)
        .filter(([assetId]) => requested.includes(assetId))
        .map(([assetId, counts]) => ({ key: assetId, label: assetId, value: counts[field] }));
      return { status: 200, body: [{ label: 'SUCCESS', data: buckets('success') }, { label: 'FAILED', data: buckets('failed') }] };
    };
    tenants.set(id, {
      tenant,
      answerPosture,
      endpoints: () => endpoints,
      genericAssets: () => genericAssets,
      users: () => users,
      markingDefinitions: () => markingDefinitions,
      answerAttack: attack.answer,
      answerVulnerability: vulnerability.answer,
    });
    return tenant;
  };

  const pageOf = <T>(content: Array<T>, request: unknown, maxSize = Number.POSITIVE_INFINITY) => {
    const body = isRecord(request) ? request : {};
    const page = typeof body['page'] === 'number' ? body['page'] : 0;
    const size = Math.min(typeof body['size'] === 'number' ? body['size'] : 100, maxSize);
    const totalPages = Math.max(1, Math.ceil(content.length / size));
    return {
      content: content.slice(page * size, (page + 1) * size),
      totalElements: content.length,
      totalPages,
      number: page,
      size,
      last: page >= totalPages - 1,
    };
  };

  let publicSettings: FakePublicSettings = { status: 404, body: { message: 'no such route GET /api/settings/public' } };

  const route = (method: string, path: string, body: unknown): SnapshotAnswer => {
    if (method === 'GET' && path === '/api/settings/public') {
      return publicSettings;
    }
    if (method === 'GET' && path === '/api/me/tenants') {
      return { status: 200, body: [...tenants.values()].map(({ tenant }) => ({ tenant_id: tenant.id, tenant_name: tenant.name })) };
    }
    const match = TENANT_ROUTE.exec(path);
    const entry = match === null ? undefined : tenants.get(match[1] ?? '');
    const subPath = match?.[2];
    if (entry === undefined || subPath === undefined) {
      return { status: 404, body: { message: `no such route ${method} ${path}` } };
    }
    const endpoints = entry.endpoints();
    if (method === 'GET' && subPath === '/tags') {
      return { status: 200, body: [] };
    }
    if (method === 'GET' && subPath === '/marking_definitions/assignable') {
      const definitions = entry.markingDefinitions();
      return definitions === null
        ? { status: 404, body: { message: `no such route ${method} ${path}` } }
        : {
          status: 200,
          body: definitions.map((marking) => ({
            marking_definition_id: marking.id,
            marking_definition_type: marking.type,
            marking_definition_definition: marking.definition,
            marking_definition_order: marking.order ?? null,
            marking_definition_stix_id: marking.stixId ?? null,
          })),
        };
    }
    if (method === 'POST' && subPath === '/assets/search') {
      const unsortable = assetSortPropertiesOf(body).find((property) => !SORTABLE_ASSET_PROPERTIES.has(property));
      if (unsortable !== undefined) {
        return { status: 400, body: { message: `Invalid sort property: ${unsortable}` } };
      }
      const idFilter = assetIdFilterOf(body);
      const rows = [
        ...endpoints.map((endpoint) => ({
          asset_id: endpoint.id,
          asset_type: 'endpoint',
          asset_name: endpoint.name,
          asset_tags: [],
          asset_agents: [],
          endpoint_platform: 'Linux',
          ...(endpoint.markings === undefined ? {} : { asset_markings: endpoint.markings }),
        })),
        ...entry.genericAssets().map((asset) => ({
          asset_id: asset.id,
          asset_type: 'asset',
          asset_name: asset.name,
          asset_category: asset.category,
          asset_tags: [],
          asset_agents: [],
          ...(asset.markings === undefined ? {} : { asset_markings: asset.markings }),
        })),
      ];
      if (idFilter !== null) {
        return { status: 200, body: pageOf(rows.filter((row) => idFilter.includes(row.asset_id)), body) };
      }
      const served = pageOf(rows, body, entry.tenant.assetPageSize);
      entry.tenant.onAssetPage?.(served.number);
      return { status: 200, body: served };
    }
    const assetId = method === 'GET' ? /^\/assets\/([^/]+)$/.exec(subPath)?.[1] : undefined;
    if (assetId !== undefined) {
      const asset = entry.genericAssets().find((candidate) => candidate.id === assetId);
      return asset === undefined
        ? { status: 404, body: { message: `no such asset ${assetId}` } }
        : { status: 200, body: { asset_id: asset.id, asset_description: asset.description, asset_url: asset.url ?? null, asset_linked_person: asset.linkedPerson ?? null } };
    }
    if (method === 'POST' && subPath === '/endpoints/find') {
      const ids = Array.isArray(body) ? body : [];
      return {
        status: 200,
        body: endpoints
          .filter((endpoint) => ids.includes(endpoint.id))
          .map((endpoint) => ({
            asset_id: endpoint.id,
            asset_hostname: endpoint.hostname,
            asset_ips: [],
            asset_mac_addresses: endpoint.macAddresses ?? [],
            endpoint_platform: 'Linux',
            asset_agents: [],
          })),
      };
    }
    if (method === 'POST' && subPath === '/users/find') {
      const ids = Array.isArray(body) ? body : [];
      return {
        status: 200,
        body: entry.users()
          .filter((user) => ids.includes(user.id))
          .map((user) => ({ user_id: user.id, user_firstname: user.firstName, user_lastname: user.lastName, user_email: user.email })),
      };
    }
    if (method === 'POST' && subPath === '/ai_targets/search') {
      return { status: 200, body: pageOf([], body) };
    }
    if (method === 'POST' && subPath === '/dashboards/adhoc/series') {
      return entry.answerPosture(body);
    }
    if (method === 'POST' && subPath === '/snapshot/attack-observations/search') {
      return entry.answerAttack(body);
    }
    if (method === 'POST' && subPath === '/snapshot/vulnerability-observations/search') {
      return entry.answerVulnerability(body);
    }
    return { status: 404, body: { message: `no such route ${method} ${path}` } };
  };

  const server = createServer((req, res) => {
    const chunks: Array<Buffer> = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const method = req.method ?? 'GET';
      const path = new URL(req.url ?? '/', 'http://fake-openaev').pathname;
      const body = readBody(chunks);
      const match = TENANT_ROUTE.exec(path);
      const requestRoute = match === null ? path : (match[2] ?? path);
      const isProbe = requestRoute.startsWith('/snapshot/') && isRecord(body) && Object.keys(body).length === 1 && body['page_size'] === 1;
      (isProbe ? probes : requests).push({
        method,
        route: requestRoute,
        tenantId: match?.[1] ?? null,
        body,
        cursor: isRecord(body) && typeof body['cursor'] === 'string' ? body['cursor'] : null,
      });
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'unauthorized' }));
        return;
      }
      const answer = route(method, path, body);
      res.writeHead(answer.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer.body));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a listening TCP server always reports an AddressInfo
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        token: TOKEN,
        addTenant,
        setPublicSettings: (settings) => {
          publicSettings = settings;
        },
        requests,
        probes,
        requestsTo: (method, routeName, tenantId) => requests.filter((request) =>
          request.method === method && request.route === routeName && (tenantId === undefined || request.tenantId === tenantId)),
        close: () => new Promise((done) => {
          server.closeAllConnections();
          server.close(() => done(undefined));
        }),
      });
    });
  });
};
