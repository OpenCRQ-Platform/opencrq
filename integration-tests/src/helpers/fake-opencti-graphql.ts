import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

/** One Live Stream as OpenCTI's `streamCollections` returns it, filters being JSON strings. */
export interface FakeStreamCollectionNode {
  id: string,
  name: string,
  description?: string | null,
  filters?: string | null,
  origin_filters?: string | null,
  stream_live?: boolean | null,
}

export interface FakeOpenCtiGraphql {
  /** The base URL to configure the tenant with; the router appends `/graphql` itself. */
  url: string,
  /** The GraphQL documents this server was asked for, in order. */
  queries: Array<string>,
  /** The Live Streams it holds, those created through it included. */
  streams: Array<FakeStreamCollectionNode>,
  close: () => Promise<void>,
}

interface FakeOpenCtiGraphqlOptions {
  /** The capabilities of the token's user, `BYPASS` by default. */
  capabilities?: ReadonlyArray<string>,
  /** Never answers, as an OpenCTI that accepts connections and hangs. */
  stall?: boolean,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const answer = (query: string, variables: Record<string, unknown>, streams: Array<FakeStreamCollectionNode>, capabilities: ReadonlyArray<string>) => {
  if (query.includes('streamCollectionAdd')) {
    const input = isRecord(variables.input) ? variables.input : {};
    const node = { id: randomUUID(), name: text(input.name) ?? '', description: text(input.description), filters: text(input.filters), stream_live: true };
    streams.push(node);
    return { streamCollectionAdd: { id: node.id } };
  }
  if (query.includes('streamCollectionEdit')) {
    const node = streams.find((stream) => stream.id === variables.id);
    for (const patch of Array.isArray(variables.input) ? variables.input : []) {
      const key: unknown = isRecord(patch) ? patch.key : undefined;
      if (node && isRecord(patch) && Array.isArray(patch.value) && (key === 'description' || key === 'filters')) {
        node[key] = text(patch.value[0]);
      }
    }
    return { streamCollectionEdit: { fieldPatch: { id: variables.id } } };
  }
  if (query.includes('capabilities')) {
    return { me: { capabilities: capabilities.map((name) => ({ name })) } };
  }
  return { streamCollections: { edges: streams.map((node) => ({ node })) } };
};

/**
 * Serves, in memory on a free port, the GraphQL OpenCRQ sends OpenCTI about Live Streams: the
 * `streamCollections` listing, the token user's capabilities, and the creation and edit of a stream.
 * Any token is accepted. Deliberately a real socket rather than a `fetch` double, so the request
 * building and response handling under test are the real ones.
 */
export const startFakeOpenCtiGraphql = (
  nodes: ReadonlyArray<FakeStreamCollectionNode>,
  { capabilities = ['BYPASS'], stall = false }: FakeOpenCtiGraphqlOptions = {},
): Promise<FakeOpenCtiGraphql> => {
  const queries: Array<string> = [];
  const streams = nodes.map((node) => ({ ...node }));
  const server = createServer((req, res) => {
    const chunks: Array<Buffer> = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const query = isRecord(body) ? text(body.query) ?? '' : '';
      const variables = isRecord(body) && isRecord(body.variables) ? body.variables : {};
      queries.push(query);
      if (stall) {
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: answer(query, variables, streams, capabilities) }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a listening TCP server always reports an AddressInfo
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        queries,
        streams,
        close: () => new Promise((done) => {
          server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
};
