import { describe, expect, it, vi } from 'vitest';
import type { XtmOneSettings } from './xtm-one-config';
import { createReaderTokenExchange, ReaderTokenUnavailable } from './xtm-one-token-exchange';

const SETTINGS: XtmOneSettings = { url: 'http://xtm-one:4000', token: 'registration-token', platformUrl: 'https://opencrq.example.com' };
const HEADERS = () => Promise.resolve({ 'Authorization': 'Bearer opencrq-signed-token', 'X-Platform-Product': 'opencrq' });
const granted = (token: string, expiresIn = 600) => new Response(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: expiresIn }), { status: 200 });

const reasonOf = async (attempt: Promise<string>): Promise<string> => {
  try {
    await attempt;
  } catch (err) {
    if (err instanceof ReaderTokenUnavailable) {
      return err.failure;
    }
    throw err;
  }
  throw new Error('the exchange gave a token');
};

describe('createReaderTokenExchange', () => {
  it('should ask XTM One, with the reader\'s own token, for one addressed to the product', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(granted('xtm-one-signed-token'));

    const token = await createReaderTokenExchange(fetchImpl).exchange(SETTINGS, HEADERS, 'user-1', 'HTTP://OpenCTI.example:80/');

    expect(token).toBe('xtm-one-signed-token');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://xtm-one:4000/xtm/auth/exchange');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Authorization': 'Bearer opencrq-signed-token', 'X-Platform-Product': 'opencrq' });
    expect(JSON.parse(init.body)).toEqual({ audience: 'http://opencti.example' });
  });

  it('should exchange once for reads arriving together, and reuse the token until shortly before it expires', async () => {
    let clock = 0;
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(granted(`token-${fetchImpl.mock.calls.length}`)));
    const exchange = createReaderTokenExchange(fetchImpl, () => clock);

    const together = await Promise.all([1, 2, 3].map(() => exchange.exchange(SETTINGS, HEADERS, 'user-1', 'http://opencti.example')));
    expect(together).toEqual(['token-1', 'token-1', 'token-1']);
    clock = 539_000;
    expect(await exchange.exchange(SETTINGS, HEADERS, 'user-1', 'http://opencti.example/')).toBe('token-1');
    expect(await exchange.exchange(SETTINGS, HEADERS, 'user-2', 'http://opencti.example')).toBe('token-2');
    clock = 541_000;
    expect(await exchange.exchange(SETTINGS, HEADERS, 'user-1', 'http://opencti.example')).toBe('token-3');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('should ask again after a failed exchange', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(granted('xtm-one-signed-token'));
    const exchange = createReaderTokenExchange(fetchImpl);

    await expect(exchange.exchange(SETTINGS, HEADERS, 'user-1', 'http://opencti.example')).rejects.toBeInstanceOf(ReaderTokenUnavailable);
    expect(await exchange.exchange(SETTINGS, HEADERS, 'user-1', 'http://opencti.example')).toBe('xtm-one-signed-token');
  });

  it('should say why it has no token, never with a message from XTM One or the reader\'s token', async () => {
    const attempt = (fetchImpl: () => Promise<Response>, headers = HEADERS) =>
      reasonOf(createReaderTokenExchange(vi.fn(fetchImpl)).exchange(SETTINGS, headers, 'user-1', 'http://opencti.example'));
    const leaking = new Error('refused reader@example.com with Bearer opencrq-signed-token', { cause: { code: 'ECONNREFUSED' } });

    const reasons = [
      await attempt(() => Promise.resolve(new Response(JSON.stringify({ detail: 'Forbidden for reader@example.com' }), { status: 403 }))),
      await attempt(() => Promise.resolve(new Response('<html>proxy</html>', { status: 200 }))),
      await attempt(() => Promise.resolve(new Response(JSON.stringify({ token_type: 'Bearer' }), { status: 200 }))),
      await attempt(() => Promise.reject(leaking)),
      await attempt(() => Promise.reject(new DOMException('timed out for reader@example.com', 'TimeoutError'))),
      await attempt(() => Promise.resolve(granted('unused')), () => Promise.reject(new Error('signing key missing for reader@example.com'))),
    ];

    expect(reasons).toEqual([
      'XTM One refused the token exchange: HTTP 403',
      'XTM One answered the token exchange with something other than JSON',
      'XTM One answered the token exchange without a token',
      'the token exchange with XTM One failed: Error, ECONNREFUSED',
      'the token exchange with XTM One failed: TimeoutError',
      'signing the reader\'s token for XTM One failed: Error',
    ]);
    expect(JSON.stringify(reasons)).not.toMatch(/reader@example\.com|opencrq-signed-token|Forbidden/);
  });

  it('should tell XTM One\'s two refusals apart by their detail, and name neither when the detail is another', async () => {
    const refusalOf = async (detail: unknown): Promise<[string, string | null]> => {
      const err: unknown = await createReaderTokenExchange(vi.fn(() => Promise.resolve(new Response(JSON.stringify({ detail }), { status: 403 }))))
        .exchange(SETTINGS, HEADERS, 'user-1', 'http://opencti.example')
        .catch((e: unknown) => e);
      if (!(err instanceof ReaderTokenUnavailable)) {
        throw new Error('expected ReaderTokenUnavailable');
      }
      return [err.failure, err.refusal];
    };

    expect(await refusalOf('The audience is not another active registered platform')).toEqual([
      'XTM One refused the token exchange: HTTP 403, the product is not registered with it under that URL', 'audience',
    ]);
    expect(await refusalOf('User not found')).toEqual([
      'XTM One refused the token exchange: HTTP 403, the reader has no active account there', 'user',
    ]);
    expect(await refusalOf('Forbidden for reader@example.com')).toEqual(['XTM One refused the token exchange: HTTP 403', null]);
    expect(await refusalOf({ audience: 'nested' })).toEqual(['XTM One refused the token exchange: HTTP 403', null]);
  });
});
