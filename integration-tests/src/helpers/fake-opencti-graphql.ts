import type { AddressInfo } from 'node:net';
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
  close: () => Promise<void>,
}

/**
 * Serves OpenCTI's `streamCollections` GraphQL query, in memory, on a free port. Any token is
 * accepted, and every query gets the same answer: what varies between tests is the nodes, not the
 * request. Deliberately a real socket rather than a `fetch` double, so the router's own request
 * building and response handling are what the test exercises.
 */
export const startFakeOpenCtiGraphql = (
  nodes: ReadonlyArray<FakeStreamCollectionNode>,
): Promise<FakeOpenCtiGraphql> => {
  const queries: Array<string> = [];
  const server = createServer((req, res) => {
    const chunks: Array<Buffer> = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      queries.push(typeof body === 'object' && body !== null && 'query' in body ? String(body.query) : '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: { streamCollections: { edges: nodes.map((node) => ({ node })) } },
      }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a listening TCP server always reports an AddressInfo
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        queries,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
};
