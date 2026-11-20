import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtmOneSettings } from './xtm-one-config';

// The client reaches the logger, which parses the process config at import time.
const logWarn = vi.fn();
vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logWarn: (...args: Array<unknown>) => logWarn(...args), logError: vi.fn(), logFromError: vi.fn() }),
}));

const { searchXtmOneDirectory, sendXtmOneAccessNotice } = await import('./xtm-one-members');

const SETTINGS: XtmOneSettings = { url: 'http://xtm-one:4000', token: 'registration-token', platformUrl: 'https://opencrq.example.com' };
const HEADERS = { Authorization: 'Bearer per-user-jwt' };
const NOTICE = { email: 'jane@acme.com', path: '/join/secret-token', scopeName: 'Acme Corp' };

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  fetchMock.mockReset();
  logWarn.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('directory search', () => {
  it('asks XTM One as the acting user, and reads the people it finds', async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: 'u-1', full_name: 'Jane Martin', email: 'jane.martin@acme.com', is_active: true }]));

    expect(await searchXtmOneDirectory(SETTINGS, HEADERS, 'jane')).toEqual([{ id: 'u-1', fullName: 'Jane Martin', email: 'jane.martin@acme.com' }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${SETTINGS.url}/api/v1/users/directory?q=jane&limit=20`);
    expect(init).toMatchObject({ headers: HEADERS });
  });

  it('never asks XTM One for a query longer than it accepts, such as a long email', async () => {
    expect(await searchXtmOneDirectory(SETTINGS, HEADERS, `${'j'.repeat(95)}@acme.com`)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(json([]));
    await searchXtmOneDirectory(SETTINGS, HEADERS, `${'j'.repeat(91)}@acme.com`);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('finds nobody, never an error, when XTM One does not answer', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: 'Not found' }, 404));
    expect(await searchXtmOneDirectory(SETTINGS, HEADERS, 'jane')).toEqual([]);

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await searchXtmOneDirectory(SETTINGS, HEADERS, 'jane')).toEqual([]);
  });
});

describe('access notice', () => {
  it('posts the email, the scope and the path as the acting user', async () => {
    fetchMock.mockResolvedValueOnce(json({ outcome: 'notified', user_id: 'u-1', email_sent: true }));

    expect(await sendXtmOneAccessNotice(SETTINGS, HEADERS, NOTICE)).toEqual({ outcome: 'notified', xtmUserId: 'u-1', emailSent: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${SETTINGS.url}/api/v1/platform/access-notices`);
    expect(init).toMatchObject({ method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(init?.body))).toEqual({ recipient_email: 'jane@acme.com', scope_name: 'Acme Corp', path: '/join/secret-token' });
  });

  it('reads an invitation, with or without its email sent', async () => {
    fetchMock.mockResolvedValueOnce(json({ outcome: 'invited', email_sent: true, link: null }));
    expect(await sendXtmOneAccessNotice(SETTINGS, HEADERS, NOTICE)).toEqual({ outcome: 'invited', emailSent: true, link: null });

    fetchMock.mockResolvedValueOnce(json({ outcome: 'invited', email_sent: false, link: 'https://xtm-one.example.com/register?token=abc' }));
    expect(await sendXtmOneAccessNotice(SETTINGS, HEADERS, NOTICE))
      .toEqual({ outcome: 'invited', emailSent: false, link: 'https://xtm-one.example.com/register?token=abc' });
  });

  it('reads an invitation with no link, from an XTM One that does not give it, or an unreadable one', async () => {
    fetchMock.mockResolvedValueOnce(json({ outcome: 'invited', email_sent: false }));
    expect(await sendXtmOneAccessNotice(SETTINGS, HEADERS, NOTICE)).toEqual({ outcome: 'invited', emailSent: false, link: null });

    fetchMock.mockResolvedValueOnce(json({ outcome: 'invited', email_sent: false, link: 'javascript:alert(1)' }));
    expect(await sendXtmOneAccessNotice(SETTINGS, HEADERS, NOTICE)).toEqual({ outcome: 'invited', emailSent: false, link: null });
  });

  it.each([
    [403, 'refused'],
    [404, 'not-found'],
    [409, 'invitation-pending'],
    [429, 'not-sent'],
    [422, 'not-sent'],
    [502, 'not-sent'],
  ] as const)('reads a %i as %s', async (status, outcome) => {
    fetchMock.mockResolvedValueOnce(json({ detail: 'no' }, status));

    expect(await sendXtmOneAccessNotice(SETTINGS, HEADERS, NOTICE)).toEqual({ outcome });
  });

  it('reads a notice with no XTM One id, or an unreadable answer, as not sent', async () => {
    fetchMock.mockResolvedValueOnce(json({ outcome: 'notified', email_sent: true }));
    expect(await sendXtmOneAccessNotice(SETTINGS, HEADERS, NOTICE)).toEqual({ outcome: 'not-sent' });

    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    expect(await sendXtmOneAccessNotice(SETTINGS, HEADERS, NOTICE)).toEqual({ outcome: 'not-sent' });
  });

  it('never logs the path, which carries the link token, nor the email', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: 'slow down' }, 429));
    fetchMock.mockRejectedValueOnce(new Error(`fetch failed for ${NOTICE.path}`));

    await sendXtmOneAccessNotice(SETTINGS, HEADERS, NOTICE);
    await sendXtmOneAccessNotice(SETTINGS, HEADERS, NOTICE);

    const logged = JSON.stringify(logWarn.mock.calls);
    expect(logged).not.toContain('secret-token');
    expect(logged).not.toContain('jane@acme.com');
  });
});
