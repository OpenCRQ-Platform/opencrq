import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NonRetryableError } from '@app/module';
import { acquireToken, isTokenExpired } from './graph-auth';

describe('graph-auth', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('acquireToken', () => {
    it('returns accessToken and expiresAt on success', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response(
        JSON.stringify({ access_token: 'tok123', expires_in: 3600 }),
        { status: 200 },
      ));

      const result = await acquireToken('tenant-id', 'client-id', 'client-secret');
      expect(result.accessToken).toBe('tok123');
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it('throws NonRetryableError on 401/403', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 401 }));

      const err = await acquireToken('t', 'c', 's').catch((e) => e);
      expect(err).toBeInstanceOf(NonRetryableError);
    });

    it('throws plain Error on transient errors', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 500 }));

      const err = await acquireToken('t', 'c', 's').catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(NonRetryableError);
    });
  });

  describe('isTokenExpired', () => {
    it('returns false when token is still valid', () => {
      expect(isTokenExpired({ accessToken: 'x', expiresAt: Date.now() + 60_000 })).toBe(false);
    });

    it('returns true when token has expired', () => {
      expect(isTokenExpired({ accessToken: 'x', expiresAt: Date.now() - 1000 })).toBe(true);
    });
  });
});
