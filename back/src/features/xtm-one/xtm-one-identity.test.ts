import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtmOneSettings } from './xtm-one-config';
import {
  canonicalXtmOneUrl,
  getXtmOnePublishedIssuer,
  isXtmOneIssuer,
  resetXtmOneIdentities,
  resolveXtmOneIdentity,
} from './xtm-one-identity';

// XTM One in Docker: reached on its service name, public on the host port.
const INTERNAL_URL = 'http://xtm-one:4000';
const PUBLIC_ISSUER = 'http://localhost:8090';

const SETTINGS: XtmOneSettings = {
  url: INTERNAL_URL,
  token: 'registration-token',
  platformUrl: 'http://localhost:4200',
};

const metadata = (body: unknown, status = 200): Response => new Response(
  typeof body === 'string' ? body : JSON.stringify(body),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  resetXtmOneIdentities();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('XTM One reached on an internal URL', () => {
  it('trusts the issuer XTM One publishes and the configured URL, nothing else', async () => {
    fetchMock.mockResolvedValue(metadata({ issuer: `${PUBLIC_ISSUER}/` }));

    expect(await isXtmOneIssuer(SETTINGS, PUBLIC_ISSUER)).toBe(true);
    expect(await isXtmOneIssuer(SETTINGS, `${INTERNAL_URL}/`)).toBe(true);
    expect(await isXtmOneIssuer(SETTINGS, 'http://evil.example.com')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${INTERNAL_URL}/xtm/auth/metadata`);
  });

  it('is known by its published identity: the token audience and the browser URL', async () => {
    fetchMock.mockResolvedValue(metadata({ issuer: `${PUBLIC_ISSUER}/` }));

    expect(await resolveXtmOneIdentity(SETTINGS)).toBe(PUBLIC_ISSUER);
  });

  it('falls back to the configured URL when XTM One publishes no identity (404)', async () => {
    fetchMock.mockResolvedValue(metadata({ detail: 'Not Found' }, 404));

    expect(await resolveXtmOneIdentity(SETTINGS)).toBe(INTERNAL_URL);
    expect(await isXtmOneIssuer(SETTINGS, PUBLIC_ISSUER)).toBe(false);
    expect(await isXtmOneIssuer(SETTINGS, INTERNAL_URL)).toBe(true);
  });

  it('reads the document once for concurrent callers', async () => {
    fetchMock.mockResolvedValue(metadata({ issuer: PUBLIC_ISSUER }));

    const answers = await Promise.all([
      resolveXtmOneIdentity(SETTINGS),
      resolveXtmOneIdentity(SETTINGS),
      isXtmOneIssuer(SETTINGS, PUBLIC_ISSUER),
    ]);

    expect(answers).toEqual([PUBLIC_ISSUER, PUBLIC_ISSUER, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the last identity XTM One published while it cannot be reached', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(metadata({ issuer: PUBLIC_ISSUER }));
    expect(await getXtmOnePublishedIssuer(SETTINGS)).toBe(PUBLIC_ISSUER);

    vi.advanceTimersByTime(60 * 60_000 + 1);
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await getXtmOnePublishedIssuer(SETTINGS)).toBe(PUBLIC_ISSUER);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(await getXtmOnePublishedIssuer(SETTINGS)).toBe(PUBLIC_ISSUER);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['no issuer', {}],
    ['a null issuer', { issuer: null }],
    ['a non-textual issuer', { issuer: 42 }],
    ['a non-http issuer', { issuer: 'ftp://xtm.example.com' }],
    ['an issuer with user info', { issuer: 'https://user@xtm.example.com' }],
    ['a body that is not JSON', '<html>'],
  ])('a 200 with %s is a failed read: the last identity is kept', async (_, body) => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(metadata({ issuer: PUBLIC_ISSUER }));
    expect(await getXtmOnePublishedIssuer(SETTINGS)).toBe(PUBLIC_ISSUER);

    vi.advanceTimersByTime(60 * 60_000 + 1);
    fetchMock.mockResolvedValueOnce(metadata(body));
    await getXtmOnePublishedIssuer(SETTINGS);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(await getXtmOnePublishedIssuer(SETTINGS)).toBe(PUBLIC_ISSUER);
  });

  it('never follows a redirect: another origin cannot supply the identity', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(metadata({ issuer: PUBLIC_ISSUER }));
    expect(await getXtmOnePublishedIssuer(SETTINGS)).toBe(PUBLIC_ISSUER);
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('manual');

    vi.advanceTimersByTime(60 * 60_000 + 1);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://evil.example.com/xtm/auth/metadata' } }));
    await getXtmOnePublishedIssuer(SETTINGS);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(await getXtmOnePublishedIssuer(SETTINGS)).toBe(PUBLIC_ISSUER);
  });

  it('drops the published identity once XTM One answers 404', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(metadata({ issuer: PUBLIC_ISSUER }));
    expect(await resolveXtmOneIdentity(SETTINGS)).toBe(PUBLIC_ISSUER);

    vi.advanceTimersByTime(60 * 60_000 + 1);
    fetchMock.mockResolvedValueOnce(metadata({ detail: 'Not Found' }, 404));
    await resolveXtmOneIdentity(SETTINGS);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(await resolveXtmOneIdentity(SETTINGS)).toBe(INTERNAL_URL);
    expect(await isXtmOneIssuer(SETTINGS, PUBLIC_ISSUER)).toBe(false);
  });
});

describe('XTM One reached on its public URL (SaaS)', () => {
  it('trusts its own tokens without reading the metadata document', async () => {
    const saas = { ...SETTINGS, url: 'https://acme.one.filigran.io' };

    expect(await isXtmOneIssuer(saas, 'https://acme.one.filigran.io/')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('canonicalXtmOneUrl', () => {
  it.each([
    ['HTTP://LocalHost:8090/', 'http://localhost:8090'],
    ['https://xtm.example.com:443/base/', 'https://xtm.example.com/base'],
    ['http://xtm-one:80', 'http://xtm-one'],
    ['http://xtm_one:4000', 'http://xtm_one:4000'],
    ['http://[::1]:4000/', 'http://[::1]:4000'],
  ])('reads %s as %s', (url, expected) => {
    expect(canonicalXtmOneUrl(url)).toBe(expected);
  });

  it.each([
    'ftp://xtm-one',
    'not a url',
    '',
    'https://xtm-one.example/?target=other',
    'https://xtm-one.example/#fragment',
    'https://user@xtm-one.example',
    'http://xtm-one:-2',
  ])('gives %s no canonical form', (url) => {
    expect(canonicalXtmOneUrl(url)).toBeUndefined();
  });
});
