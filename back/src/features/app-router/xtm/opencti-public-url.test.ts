import { describe, expect, it, vi } from 'vitest';
import { ReaderTokenUnavailable } from '../../xtm-one/xtm-one-token-exchange';
import { createOpenctiPublicUrl, OPENCTI_PUBLIC_URL_QUERY } from './opencti-public-url';

const CONNECTION = { url: 'http://opencti.internal:4000/', token: 'connector-token' };
const settingsAnswer = (platformUrl: unknown) => new Response(JSON.stringify({ data: { settings: { platform_url: platformUrl } } }), { status: 200 });

const failureOf = async (answer: () => Promise<Response>): Promise<string> => {
  const err: unknown = await createOpenctiPublicUrl(vi.fn(answer)).resolve(CONNECTION).catch((e: unknown) => e);
  if (!(err instanceof ReaderTokenUnavailable)) {
    throw new Error('expected ReaderTokenUnavailable');
  }
  return err.failure;
};

describe('createOpenctiPublicUrl', () => {
  it('should read platform_url from OpenCTI\'s settings with the connector token, as one spelling', async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(settingsAnswer('HTTPS://OpenCTI.Example.com:443/')));

    expect(await createOpenctiPublicUrl(fetchImpl).resolve(CONNECTION)).toBe('https://opencti.example.com');
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('http://opencti.internal:4000/graphql');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer connector-token' });
    expect(JSON.parse(String(init?.body))).toEqual({ query: OPENCTI_PUBLIC_URL_QUERY });
  });

  it('should read once for reads arriving together, and again after an hour', async () => {
    let clock = 0;
    const fetchImpl = vi.fn(() => Promise.resolve(settingsAnswer('https://opencti.example.com')));
    const publicUrl = createOpenctiPublicUrl(fetchImpl, () => clock);

    await Promise.all([1, 2, 3].map(() => publicUrl.resolve(CONNECTION)));
    clock = 60 * 60_000 - 1;
    await publicUrl.resolve(CONNECTION);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock = 60 * 60_000 + 1;
    await publicUrl.resolve(CONNECTION);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('should read again after a failure', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(settingsAnswer('https://opencti.example.com'));
    const publicUrl = createOpenctiPublicUrl(fetchImpl);

    await expect(publicUrl.resolve(CONNECTION)).rejects.toBeInstanceOf(ReaderTokenUnavailable);
    expect(await publicUrl.resolve(CONNECTION)).toBe('https://opencti.example.com');
  });

  it('should say why the URL is unknown, never with OpenCTI\'s message or the token', async () => {
    const failures = [
      await failureOf(() => Promise.reject(new Error('connect failed with Bearer connector-token', { cause: { code: 'ECONNREFUSED' } }))),
      await failureOf(() => Promise.resolve(new Response('no', { status: 401 }))),
      await failureOf(() => Promise.resolve(new Response('<html>Sign in</html>', { status: 200 }))),
      await failureOf(() => Promise.resolve(new Response(JSON.stringify({ errors: [{ message: 'connector-token is revoked', extensions: { code: 'AUTH_REQUIRED' } }] })))),
      await failureOf(() => Promise.resolve(settingsAnswer('/'))),
      await failureOf(() => Promise.resolve(settingsAnswer(null))),
    ];

    expect(failures).toEqual([
      'reading OpenCTI\'s public URL failed: Error, ECONNREFUSED',
      'reading OpenCTI\'s public URL failed: HTTP 401',
      'reading OpenCTI\'s public URL failed: the answer is not JSON',
      'reading OpenCTI\'s public URL failed: OpenCTI refused the query: AUTH_REQUIRED',
      'reading OpenCTI\'s public URL failed: the settings name no usable platform_url',
      'reading OpenCTI\'s public URL failed: the settings name no usable platform_url',
    ]);
    expect(JSON.stringify(failures)).not.toContain('connector-token');
  });
});
