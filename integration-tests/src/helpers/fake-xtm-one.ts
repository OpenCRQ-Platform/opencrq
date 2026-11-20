import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';

export interface FakeXtmOne {
  /** The base URL to register against; the client appends the registration path itself. */
  url: string,
  /** The JSON body of every registration received, in order. */
  requests: Array<Record<string, unknown>>,
  close: () => Promise<void>,
}

/**
 * Answers XTM One's registration POST, in memory, on a free port, with whatever `answer` builds for
 * the `platform_id` and body that registered: a stand-in for any host the XTM One URL may name. Deliberately
 * a real socket rather than a `fetch` double, so the client's own request and response handling are
 * what the test exercises. `rawBody` is sent verbatim in place of `answer`, for the bodies JSON
 * cannot express (an HTML page from a proxy or a captive portal). `cutBody` is written after the
 * headers, then the socket is destroyed, for a connection dropped mid-answer.
 */
export const startFakeXtmOne = (
  answer: (platformId: string, body: Record<string, unknown>) => unknown,
  options?: { status?: number, rawBody?: { body: string, contentType: string }, cutBody?: string },
): Promise<FakeXtmOne> => {
  const status = options?.status ?? 200;
  const requests: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    const chunks: Array<Buffer> = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const body = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed)) : {};
      requests.push(body);
      const platformId = 'platform_id' in body ? String(body.platform_id) : '';
      if (options?.cutBody !== undefined) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.write(options.cutBody, () => res.destroy());
        return;
      }
      if (options?.rawBody) {
        res.writeHead(status, { 'content-type': options.rawBody.contentType });
        res.end(options.rawBody.body);
        return;
      }
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer(platformId, body)));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a listening TCP server always reports an AddressInfo
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
};
