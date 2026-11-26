import { describe, expect, it, vi } from 'vitest';

const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));
// The logger parses the process config at import time.
vi.mock('../../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logWarn }),
}));

const { createPublicProductUrls } = await import('./public-product-urls');

const CONNECTION = { url: 'http://opencti:8080/', token: 'connector-token' };
const NEVER = () => Promise.reject(new Error('not asked'));

describe('createPublicProductUrls', () => {
  it('should answer the URL the product names itself', async () => {
    const opencti = vi.fn(() => Promise.resolve('https://opencti.example.com'));
    const urls = createPublicProductUrls({ opencti, openaev: NEVER });

    expect(await urls.resolve('opencti', CONNECTION)).toBe('https://opencti.example.com');
    expect(opencti).toHaveBeenCalledWith(CONNECTION);
  });

  it('should answer the connection URL, without a trailing slash, when the product cannot be asked', async () => {
    const urls = createPublicProductUrls({ opencti: NEVER, openaev: () => Promise.reject(new Error('refused')) });

    expect(await urls.resolve('openaev', { url: 'http://openaev:8080/', token: 't' })).toBe('http://openaev:8080');
    expect(logWarn).toHaveBeenCalledWith('Product public URL unknown, using the connection URL', { product: 'openaev', reason: 'refused' });
  });

  it('should ask each product once for calls arriving together, and again after an hour', async () => {
    let clock = 0;
    const opencti = vi.fn(() => Promise.resolve('https://opencti.example.com'));
    const urls = createPublicProductUrls({ opencti, openaev: NEVER }, () => clock);

    await Promise.all([1, 2, 3].map(() => urls.resolve('opencti', CONNECTION)));
    clock = 60 * 60_000 - 1;
    await urls.resolve('opencti', CONNECTION);
    expect(opencti).toHaveBeenCalledTimes(1);

    clock = 60 * 60_000 + 1;
    await urls.resolve('opencti', CONNECTION);
    expect(opencti).toHaveBeenCalledTimes(2);
  });

  it('should not ask a product that failed again for a minute, then ask again', async () => {
    let clock = 0;
    const opencti = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP 503'))
      .mockResolvedValueOnce('https://opencti.example.com');
    const urls = createPublicProductUrls({ opencti, openaev: NEVER }, () => clock);

    expect(await urls.resolve('opencti', CONNECTION)).toBe('http://opencti:8080');
    clock = 60_000 - 1;
    expect(await urls.resolve('opencti', CONNECTION)).toBe('http://opencti:8080');
    expect(opencti).toHaveBeenCalledTimes(1);

    clock = 60_000 + 1;
    expect(await urls.resolve('opencti', CONNECTION)).toBe('https://opencti.example.com');
    expect(opencti).toHaveBeenCalledTimes(2);
  });

  it('should keep one answer per product and connection', async () => {
    const opencti = vi.fn((connection: { url: string }) => Promise.resolve(`https://public.${new URL(connection.url).hostname}`));
    const urls = createPublicProductUrls({ opencti, openaev: NEVER });

    expect(await urls.resolve('opencti', { url: 'http://a:1', token: 't' })).toBe('https://public.a');
    expect(await urls.resolve('opencti', { url: 'http://b:1', token: 't' })).toBe('https://public.b');
  });
});
