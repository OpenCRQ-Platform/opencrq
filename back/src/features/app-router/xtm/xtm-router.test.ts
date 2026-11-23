import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtmOneSettings } from '../../xtm-one/xtm-one-config';
import type * as TokenExchange from '../../xtm-one/xtm-one-token-exchange';

// The tRPC instance reaches the logger, which parses the process config at import time.
vi.mock('../../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logWarn: vi.fn(), logError: vi.fn(), logFromError: vi.fn() }),
}));

vi.mock('../../../config', () => ({ config: () => ({}) }));

const settings = vi.hoisted(() => ({ current: null as XtmOneSettings | null }));
vi.mock('../../xtm-one/xtm-one-config', () => ({ getXtmOneSettings: () => settings.current }));

const { exchange, buildXtmOneHeaders } = vi.hoisted(() => ({
  exchange: vi.fn().mockResolvedValue('xtm-one-signed-token'),
  buildXtmOneHeaders: vi.fn().mockResolvedValue({ Authorization: 'Bearer opencrq-signed-token' }),
}));
vi.mock('../../xtm-one/xtm-one-token-exchange', async (importOriginal) => ({
  ...await importOriginal<typeof TokenExchange>(),
  readerTokenExchange: { exchange },
}));
vi.mock('../../xtm-one/xtm-one-headers', () => ({ buildXtmOneHeaders }));

const { resolvePublicUrl } = vi.hoisted(() => ({ resolvePublicUrl: vi.fn() }));
vi.mock('./opencti-public-url', () => ({ openctiPublicUrl: { resolve: resolvePublicUrl } }));

const { probeReaderLink, readerAuthorization, readerScopeAuthorization } = await import('./xtm-router');
const { ReaderTokenUnavailable } = await import('../../xtm-one/xtm-one-token-exchange');

beforeEach(() => {
  exchange.mockClear();
  resolvePublicUrl.mockReset().mockResolvedValue('https://opencti.public.example');
});

const USER = { id: 'user-1', email: 'reader@example.com', name: 'Reader' };
const SETTINGS: XtmOneSettings = { url: 'http://xtm-one:4000', token: 'registration-token', platformUrl: 'https://opencrq.example.com' };
const DB = {};
const OPENCTI = { url: 'http://opencti.internal:4000/', token: 'connector-token' };
const OPENAEV = { url: 'http://openaev.internal:8080', token: 'connector-token' };
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- it reads the user's id, email and name, and hands the database to the signer
const authorize = (user: typeof USER | null) => readerAuthorization(DB as never, user as never);

describe('readerAuthorization', () => {
  it('should say why it signs nothing without a user or without XTM One', async () => {
    settings.current = SETTINGS;
    const noUser = authorize(null);
    settings.current = null;
    const noXtmOne = authorize(USER);

    expect(await noUser('opencti', OPENCTI)).toBeNull();
    expect(noUser.unsigned).toBe('no user to sign for');
    expect(await noXtmOne('opencti', OPENCTI)).toBeNull();
    expect(noXtmOne.unsigned).toBe('XTM One is not configured');
    expect(resolvePublicUrl).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
  });

  it('should read OpenCTI with the token XTM One signs for the reader, addressed to the URL OpenCTI registered', async () => {
    settings.current = SETTINGS;
    const authorization = authorize(USER);

    expect(authorization.unsigned).toBeUndefined();
    expect(await authorization('opencti', OPENCTI)).toBe('xtm-one-signed-token');
    expect(resolvePublicUrl).toHaveBeenCalledWith(OPENCTI);
    const [sentSettings, xtmOneHeaders, userId, audience] = exchange.mock.calls[0] ?? [];
    expect([sentSettings, userId, audience]).toEqual([SETTINGS, 'user-1', 'https://opencti.public.example']);
    await xtmOneHeaders();
    expect(buildXtmOneHeaders).toHaveBeenCalledWith(SETTINGS, DB, USER);
  });

  it('should address OpenAEV\'s token to its connector URL', async () => {
    settings.current = SETTINGS;

    await authorize(USER)('openaev', OPENAEV);

    expect(resolvePublicUrl).not.toHaveBeenCalled();
    expect(exchange.mock.calls[0]?.[3]).toBe('http://openaev.internal:8080');
  });

  it('should ask XTM One nothing when OpenCTI\'s public URL cannot be read', async () => {
    settings.current = SETTINGS;
    const unreadable = new Error('reading OpenCTI\'s public URL failed: HTTP 401');
    resolvePublicUrl.mockRejectedValue(unreadable);

    await expect(authorize(USER)('opencti', OPENCTI)).rejects.toBe(unreadable);
    expect(exchange).not.toHaveBeenCalled();
  });
});

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- it reads the user's id, email and name, and hands the database to the signer
const scopeAuthorization = (user: typeof USER | null, visibility: 'per_member' | 'service_account') => readerScopeAuthorization(DB as never, user as never, visibility);

describe('readerScopeAuthorization', () => {
  it('should ask OpenCTI with the connector token once the tenant reads as the service account, XTM One or not', async () => {
    settings.current = null;

    expect(await scopeAuthorization(USER, 'service_account')('opencti', OPENCTI)).toBe('connector-token');
    expect(await scopeAuthorization(null, 'service_account')('opencti', OPENCTI)).toBe('connector-token');
    expect(exchange).not.toHaveBeenCalled();
  });

  it('should ask OpenCTI as the member otherwise', async () => {
    settings.current = SETTINGS;

    expect(await scopeAuthorization(USER, 'per_member')('opencti', OPENCTI)).toBe('xtm-one-signed-token');
    expect(exchange).toHaveBeenCalledTimes(1);
    settings.current = null;
    const unsigned = scopeAuthorization(USER, 'per_member');
    expect(await unsigned('opencti', OPENCTI)).toBeNull();
    expect(unsigned.unsigned).toBe('XTM One is not configured');
  });
});

describe('probeReaderLink', () => {
  it('should call OpenCTI unlinked only when XTM One names its URL as no registered platform', async () => {
    settings.current = SETTINGS;
    const refusedWith = (refusal: 'audience' | 'user' | null) => {
      exchange.mockRejectedValueOnce(new ReaderTokenUnavailable('refused', refusal));
      return probeReaderLink(authorize(USER), OPENCTI);
    };

    expect(await probeReaderLink(authorize(USER), OPENCTI)).toBe('linked');
    expect(await refusedWith('audience')).toBe('not_linked');
    expect(await refusedWith('user')).toBe('unknown');
    expect(await refusedWith(null)).toBe('unknown');
    resolvePublicUrl.mockRejectedValueOnce(new ReaderTokenUnavailable('reading OpenCTI\'s public URL failed: HTTP 401'));
    expect(await probeReaderLink(authorize(USER), OPENCTI)).toBe('unknown');
    settings.current = null;
    expect(await probeReaderLink(authorize(USER), OPENCTI)).toBe('unknown');
  });
});
