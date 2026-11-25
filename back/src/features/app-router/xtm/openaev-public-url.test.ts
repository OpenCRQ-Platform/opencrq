import { describe, expect, it, vi } from 'vitest';
import { readOpenaevPublicUrl } from './openaev-public-url';

const CONNECTION = { url: 'http://openaev.internal:8080/', token: 'connector-token' };
const settingsAnswer = (platformBaseUrl: unknown) => new Response(JSON.stringify({ platform_base_url: platformBaseUrl }), { status: 200 });

const failureOf = async (answer: () => Promise<Response>): Promise<string> => {
  const err: unknown = await readOpenaevPublicUrl(CONNECTION, vi.fn(answer)).catch((e: unknown) => e);
  if (!(err instanceof Error)) {
    throw new Error('expected an Error');
  }
  return err.message;
};

describe('readOpenaevPublicUrl', () => {
  it('should read platform_base_url from OpenAEV\'s settings with the connector token, as one spelling', async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(settingsAnswer('HTTPS://OpenAEV.Example.com:443/')));

    expect(await readOpenaevPublicUrl(CONNECTION, fetchImpl)).toBe('https://openaev.example.com');
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('http://openaev.internal:8080/api/settings');
    expect(init?.redirect).toBe('manual');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer connector-token' });
  });

  it('should say why the URL is unknown, never with OpenAEV\'s message or the token', async () => {
    const failures = [
      await failureOf(() => Promise.reject(new Error('connect failed with Bearer connector-token', { cause: { code: 'ECONNREFUSED' } }))),
      await failureOf(() => Promise.resolve(new Response('no', { status: 401 }))),
      await failureOf(() => Promise.resolve(new Response('<html>Sign in</html>', { status: 200 }))),
      await failureOf(() => Promise.resolve(settingsAnswer('javascript:alert(1)'))),
      await failureOf(() => Promise.resolve(settingsAnswer('https://user:secret@openaev.example.com'))),
      await failureOf(() => Promise.resolve(settingsAnswer(null))),
    ];

    expect(failures).toEqual([
      expect.stringContaining('reading OpenAEV\'s public URL failed'),
      'reading OpenAEV\'s public URL failed: HTTP 401',
      'reading OpenAEV\'s public URL failed: the answer is not JSON',
      'reading OpenAEV\'s public URL failed: the settings name no usable platform_base_url',
      'reading OpenAEV\'s public URL failed: the settings name no usable platform_base_url',
      'reading OpenAEV\'s public URL failed: the settings name no usable platform_base_url',
    ]);
    for (const failure of failures) {
      expect(failure).not.toContain('connector-token');
      expect(failure).not.toContain('secret');
    }
  });
});
