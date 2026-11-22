import type { SyncedMarkingDefinition } from '@app/module';
import { newError } from '@app/utils';

/**
 * Reads the marking definitions of a tenant's OpenCTI (CTEM marking parity, G2, slice 3b), so the
 * tenant's OpenCRQ marking definitions carry the same markings under the same STIX ids, with
 * OpenCTI's colour and order. Two sources: the GraphQL API, read with the connector token when the
 * stream consumer starts, and the stream itself, whose `marking-definition` objects keep them in step
 * afterwards.
 */

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const OPENCTI_EXTENSION_ID = 'extension-definition--ea279b3e-5c71-4632-ac08-831c66a786ba';
const MARKINGS_PAGE_SIZE = 500;
/** OpenCTI ships a few dozen markings; this bounds a misbehaving pagination, not a real tenant. */
const MAX_MARKINGS_PAGES = 20;
const MARKINGS_TIMEOUT_MS = 10_000;

export const MARKING_DEFINITIONS_QUERY = 'query OpenCrqMarkingDefinitions($first: Int, $after: ID) { markingDefinitions(first: $first, after: $after) { edges { node { standard_id definition_type definition x_opencti_order x_opencti_color } } pageInfo { endCursor hasNextPage } } }';

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const stringOf = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const orderOf = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) ? value : 0);

/** A GraphQL `MarkingDefinition` node, or `null` when it lacks its id, type or definition. */
export const parseMarkingNode = (node: unknown): SyncedMarkingDefinition | null => {
  if (!isRecord(node)) {
    return null;
  }
  const stixId = stringOf(node.standard_id);
  const definitionType = stringOf(node.definition_type);
  const definition = stringOf(node.definition);
  if (!stixId || !definitionType || !definition) {
    return null;
  }
  return { stixId, definitionType, definition, color: stringOf(node.x_opencti_color), order: orderOf(node.x_opencti_order) };
};

/**
 * A `marking-definition` object of the live stream (`convertMarkingToStix`): `definition_type` and
 * `name` at the top, the order and colour in OpenCTI's extension. `null` for anything else.
 */
export const parseStreamMarking = (stixObject: Record<string, unknown>): SyncedMarkingDefinition | null => {
  if (stixObject.type !== 'marking-definition') {
    return null;
  }
  const stixId = stringOf(stixObject.id);
  const definitionType = stringOf(stixObject.definition_type);
  const definition = stringOf(stixObject.name);
  if (!stixId || !definitionType || !definition) {
    return null;
  }
  const extensions = isRecord(stixObject.extensions) ? stixObject.extensions : {};
  const octi = isRecord(extensions[OPENCTI_EXTENSION_ID]) ? extensions[OPENCTI_EXTENSION_ID] : {};
  return { stixId, definitionType, definition, color: stringOf(octi.color), order: orderOf(octi.order) };
};

interface MarkingsPage {
  markings: Array<SyncedMarkingDefinition>,
  endCursor: string | null,
  hasNextPage: boolean,
}

/** One page of `markingDefinitions`, or `null` when the answer is not that shape. */
export const parseMarkingsPage = (answer: unknown): MarkingsPage | null => {
  const data = isRecord(answer) && isRecord(answer.data) ? answer.data : undefined;
  const connection = data && isRecord(data.markingDefinitions) ? data.markingDefinitions : undefined;
  if (!connection || !Array.isArray(connection.edges)) {
    return null;
  }
  const markings = connection.edges.flatMap((edge: unknown) => {
    const parsed = isRecord(edge) ? parseMarkingNode(edge.node) : null;
    return parsed ? [parsed] : [];
  });
  const pageInfo = isRecord(connection.pageInfo) ? connection.pageInfo : {};
  return { markings, endCursor: stringOf(pageInfo.endCursor), hasNextPage: pageInfo.hasNextPage === true };
};

/**
 * Every marking definition the connector token reads in OpenCTI. Throws on a refusal, a timeout or a
 * malformed answer, so the caller keeps what the tenant already holds instead of syncing a part.
 */
export const fetchOpenCtiMarkingDefinitions = async (
  url: string, token: string, fetchImpl: FetchLike = fetch,
): Promise<Array<SyncedMarkingDefinition>> => {
  const endpoint = `${url.replace(/\/+$/, '')}/graphql`;
  const markings: Array<SyncedMarkingDefinition> = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_MARKINGS_PAGES; page += 1) {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      // Never logged: the header carries the connector token.
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: MARKING_DEFINITIONS_QUERY, variables: { first: MARKINGS_PAGE_SIZE, after } }),
      signal: AbortSignal.timeout(MARKINGS_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw newError('OpenCTI marking definitions read failed', { status: res.status });
    }
    const parsed = parseMarkingsPage(await res.json());
    if (parsed === null) {
      throw newError('OpenCTI marking definitions answer has an unexpected shape');
    }
    markings.push(...parsed.markings);
    if (!parsed.hasNextPage || parsed.endCursor === null) {
      return markings;
    }
    after = parsed.endCursor;
  }
  return markings;
};
