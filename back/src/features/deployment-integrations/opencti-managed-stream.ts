import type { DescribedStream } from '../app-router/opencti/opencti-stream-filter-utils';
import { newError } from '@app/utils';

/**
 * The OpenCTI Live Stream OpenCRQ manages for a tenant the deployment connects to OpenCTI: found by
 * the marker its description carries, created with the canonical filter when none exists, and
 * brought back to the canonical filter when it carries an older version of it. The name is only a
 * label: a stream an admin renamed is still found, and a stream someone else named the same is not
 * taken for it.
 *
 * Creating and editing a stream needs `TAXIIAPI_SETCOLLECTIONS` on the token (or `BYPASS`, which an
 * admin token holds). Without it nothing is written in OpenCTI and the caller is told which
 * capability is missing.
 */

export const MANAGED_STREAM_NAME = 'OpenCRQ threat feed';

/** Bumped whenever the canonical filter changes, so a stream created before is updated at the next boot. */
export const MANAGED_STREAM_FILTER_VERSION = 1;

export const MANAGED_STREAM_CAPABILITY = 'TAXIIAPI_SETCOLLECTIONS';

const MARKER_PREFIX = 'opencrq-managed-stream:v';

const MARKER_PATTERN = /opencrq-managed-stream:v(\d+)/;

export const managedStreamDescription = (): string =>
  'Created and kept up to date by OpenCRQ: the threats, and the relationships its risk model reads. '
  + `Edits to its filter are replaced at OpenCRQ's next start. [${MARKER_PREFIX}${MANAGED_STREAM_FILTER_VERSION}]`;

const THREAT_TYPES = ['Intrusion-Set', 'Threat-Actor-Group', 'Threat-Actor-Individual', 'Campaign'];

const clause = (key: string, values: Array<string>) => ({ key: [key], operator: 'eq', values, mode: 'or' });

const alternative = (filters: Array<ReturnType<typeof clause>>) => ({ mode: 'and', filters, filterGroups: [] });

/**
 * The filter `docs/deployment/opencti-connector.md` documents: the threats and the reports, `targets`
 * to a location, a sector or a vulnerability, `uses` to an attack pattern or a malware, and
 * `attributed-to` between threat types. Keep both in step.
 */
export const CANONICAL_STREAM_FILTER = {
  mode: 'or',
  filters: [],
  filterGroups: [
    alternative([clause('entity_type', [...THREAT_TYPES, 'Report'])]),
    alternative([clause('entity_type', ['targets']), clause('fromTypes', THREAT_TYPES), clause('toTypes', ['Location', 'Sector', 'Vulnerability'])]),
    alternative([clause('entity_type', ['uses']), clause('fromTypes', THREAT_TYPES), clause('toTypes', ['Attack-Pattern', 'Malware'])]),
    alternative([
      clause('entity_type', ['attributed-to']),
      clause('fromTypes', ['Campaign', 'Intrusion-Set']),
      clause('toTypes', ['Intrusion-Set', 'Threat-Actor-Group', 'Threat-Actor-Individual']),
    ]),
  ],
};

export const CANONICAL_STREAM_FILTER_JSON = JSON.stringify(CANONICAL_STREAM_FILTER);

/** The marker's version, or null for a stream OpenCRQ does not manage. */
export const managedStreamVersion = (description: string | null): number | null => {
  const match = description ? MARKER_PATTERN.exec(description) : null;
  return match?.[1] === undefined ? null : Number(match[1]);
};

const sameFilter = (raw: string | null): boolean => {
  if (raw === null) {
    return false;
  }
  try {
    return JSON.stringify(JSON.parse(raw)) === CANONICAL_STREAM_FILTER_JSON;
  } catch {
    return false;
  }
};

export interface ManagedStreamConnection { url: string, token: string }

export interface ManagedStreamDeps {
  listStreams: (connection: ManagedStreamConnection) => Promise<Array<DescribedStream>>,
  /** The capability names the token's user holds. */
  readCapabilities: (connection: ManagedStreamConnection) => Promise<Array<string>>,
  createStream: (connection: ManagedStreamConnection, input: { name: string, description: string, filters: string }) => Promise<string>,
  updateStream: (connection: ManagedStreamConnection, streamId: string, patch: { description: string, filters: string }) => Promise<void>,
}

export type ManagedStreamOutcome =
  | { kind: 'created' | 'updated' | 'unchanged', streamId: string }
  | { kind: 'missing_capability', capability: string };

export const holdsStreamCapability = (capabilities: ReadonlyArray<string>): boolean =>
  capabilities.some((name) => name === 'BYPASS' || name.includes(MANAGED_STREAM_CAPABILITY));

/** The managed stream with the newest marker, so a duplicate left by an older release never wins. */
export const findManagedStream = (streams: ReadonlyArray<DescribedStream>): DescribedStream | null => {
  let found: DescribedStream | null = null;
  let foundVersion = -1;
  for (const stream of streams) {
    const version = managedStreamVersion(stream.description);
    if (version !== null && version > foundVersion) {
      found = stream;
      foundVersion = version;
    }
  }
  return found;
};

export const isManagedStreamCurrent = (stream: DescribedStream): boolean =>
  managedStreamVersion(stream.description) === MANAGED_STREAM_FILTER_VERSION && sameFilter(stream.rawFilter);

/**
 * Finds, creates or updates the managed stream. A stream already current is left alone without
 * asking for the capability, so a token that lost it after the stream was made keeps working.
 */
export const ensureManagedStream = async (deps: ManagedStreamDeps, connection: ManagedStreamConnection): Promise<ManagedStreamOutcome> => {
  const existing = findManagedStream(await deps.listStreams(connection));
  if (existing !== null && isManagedStreamCurrent(existing)) {
    return { kind: 'unchanged', streamId: existing.id };
  }
  if (!holdsStreamCapability(await deps.readCapabilities(connection))) {
    return { kind: 'missing_capability', capability: MANAGED_STREAM_CAPABILITY };
  }
  const description = managedStreamDescription();
  if (existing !== null) {
    await deps.updateStream(connection, existing.id, { description, filters: CANONICAL_STREAM_FILTER_JSON });
    return { kind: 'updated', streamId: existing.id };
  }
  const streamId = await deps.createStream(connection, { name: MANAGED_STREAM_NAME, description, filters: CANONICAL_STREAM_FILTER_JSON });
  return { kind: 'created', streamId };
};

const ME_CAPABILITIES_QUERY = 'query OpencrqStreamCapabilities { me { capabilities { name } } }';

const CREATE_STREAM_MUTATION = `
  mutation OpencrqManagedStreamAdd($input: StreamCollectionAddInput!) {
    streamCollectionAdd(input: $input) { id }
  }
`;

const UPDATE_STREAM_MUTATION = `
  mutation OpencrqManagedStreamEdit($id: ID!, $input: [EditInput]!) {
    streamCollectionEdit(id: $id) { fieldPatch(input: $input) { id } }
  }
`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** One GraphQL call; a transport error, an HTTP error or a GraphQL error throws with what OpenCTI said. */
export const postOpenctiGraphql = async (
  connection: ManagedStreamConnection,
  query: string,
  variables: Record<string, unknown> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> => {
  const res = await fetchImpl(`${connection.url.replace(/\/$/, '')}/graphql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw newError('OpenCTI GraphQL call failed', { status: res.status, body: text.slice(0, 300) });
  }
  const body: unknown = JSON.parse(text);
  if (!isRecord(body)) {
    throw newError('OpenCTI GraphQL answered an unexpected shape');
  }
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    throw newError('OpenCTI GraphQL answered an error', { errors: JSON.stringify(body.errors).slice(0, 300) });
  }
  if (!isRecord(body.data)) {
    throw newError('OpenCTI GraphQL answered no data');
  }
  return body.data;
};

export const parseCapabilities = (data: Record<string, unknown>): Array<string> => {
  const me = data.me;
  if (!isRecord(me) || !Array.isArray(me.capabilities)) {
    throw newError('OpenCTI did not answer the capabilities of the token user');
  }
  return me.capabilities.flatMap((capability: unknown) =>
    (isRecord(capability) && typeof capability.name === 'string' ? [capability.name] : []));
};

export const parseCreatedStreamId = (data: Record<string, unknown>): string => {
  const created = data.streamCollectionAdd;
  if (!isRecord(created) || typeof created.id !== 'string') {
    throw newError('OpenCTI did not answer the id of the stream it created');
  }
  return created.id;
};

/** The GraphQL side of `ManagedStreamDeps`, all but the listing, which the stream picker already does. */
export const openctiManagedStreamCalls = (fetchImpl: typeof fetch = fetch): Omit<ManagedStreamDeps, 'listStreams'> => ({
  readCapabilities: async (connection) =>
    parseCapabilities(await postOpenctiGraphql(connection, ME_CAPABILITIES_QUERY, {}, fetchImpl)),
  createStream: async (connection, input) =>
    parseCreatedStreamId(await postOpenctiGraphql(connection, CREATE_STREAM_MUTATION, {
      input: { ...input, stream_live: true, stream_public: false },
    }, fetchImpl)),
  updateStream: async (connection, streamId, patch) => {
    await postOpenctiGraphql(connection, UPDATE_STREAM_MUTATION, {
      id: streamId,
      input: [{ key: 'filters', value: [patch.filters] }, { key: 'description', value: [patch.description] }],
    }, fetchImpl);
  },
});
