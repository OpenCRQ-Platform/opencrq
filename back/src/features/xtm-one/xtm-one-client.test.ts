import type { DrizzleDB } from '@app/module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { XtmOneSettings } from './xtm-one-config';
import { issueTestXtmLicense, xtmLicenseExtensions } from '../edition/xtm-license-fixtures';

// Licenses are signed by a CA of the test's own, standing in for the XTM CA pinned in the build.
const ca = await vi.hoisted(async () => {
  const fixtures = await import('../edition/xtm-license-fixtures');
  return fixtures.createTestXtmCa();
});
vi.mock('../edition/xtm-ca', () => ({ XTM_CA_PEM: ca.certificatePem }));

// The client reaches the logger, which parses the process config at import time.
const logWarn = vi.fn();
const logFromError = vi.fn();
vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    logTrace: vi.fn(),
    logWarn: (...args: Array<unknown>) => logWarn(...args),
    logError: vi.fn(),
    logFromError: (...args: Array<unknown>) => logFromError(...args),
  }),
}));

// The edition module owns the entitlement; here we assert what the registration tells it.
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
let instance = { instanceId: 'instance-1', createdAt: Date.now() - 10 * MINUTE };
const ensureInstance = vi.fn(() => Promise.resolve(instance));
const grantRemoteEntitlement = vi.fn();
const isEnterpriseEdition = vi.fn();
vi.mock('../edition', () => ({
  ensureInstance: () => ensureInstance(),
  grantRemoteEntitlement: (...args: Array<unknown>) => grantRemoteEntitlement(...args),
  isEnterpriseEdition: () => isEnterpriseEdition(),
}));

const { getEntitlementRefusal, registerWithXtmOne } = await import('./xtm-one-client');
const { getSignInClientId, recordSignInClientId } = await import('../xtm-sign-in/xtm-sign-in-client');
const {
  getXtmOneReachability,
  resetXtmOneReachability,
} = await import('./xtm-one-reachability');

const SETTINGS: XtmOneSettings = {
  url: 'https://xtm-one.example.com',
  token: 'registration-token',
  platformUrl: 'https://opencrq.example.com',
};

// Only passed through to the mocked edition module, never queried here.
const db: DrizzleDB = Object.create(null);

// Whole seconds, the precision a certificate carries its dates in.
const notAfter = Math.floor(Date.now() / 1000) * 1000 + 30 * DAY;

const license = (opencrqIds: Array<string>, type = 'standard') => issueTestXtmLicense(ca, {
  notBefore: Date.now() - DAY,
  notAfter,
  extensions: xtmLicenseExtensions({ opencrqIds, type }),
});

const respondWithText = (text: string, contentType: string) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(text, { status: 200, headers: { 'content-type': contentType } }),
  ));
};

const respondWith = (body: unknown) => {
  respondWithText(JSON.stringify(body), 'application/json');
};

describe('XTM One registration to entitlement', () => {
  beforeEach(async () => {
    instance = { instanceId: 'instance-1', createdAt: Date.now() - 10 * MINUTE };
    isEnterpriseEdition.mockReset().mockReturnValue(false);
    // The client remembers the last refusal it reported; an answer with nothing to refuse clears it.
    respondWith({ status: 'ok', ee_enabled: false });
    await registerWithXtmOne(SETTINGS, db);
    grantRemoteEntitlement.mockReset();
    logWarn.mockReset();
    resetXtmOneReachability();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('grants nothing to an answer claiming Enterprise Edition without a license', async () => {
    // What a host of the operator's choosing, or an XTM One predating the proof, answers.
    respondWith({ status: 'active', platform_identifier: 'opencrq', ee_enabled: true, user_integrations: 1, version: '1.0.0' });

    await registerWithXtmOne(SETTINGS, db);

    expect(grantRemoteEntitlement).toHaveBeenCalledWith(0, null, null);
    expect(logWarn).toHaveBeenCalledTimes(1);
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('upgrade XTM One to a release that returns xtm_license_pem'));
  });

  it('grants the Enterprise Edition a verified license proves, until the license ends', async () => {
    respondWith({ status: 'active', ee_enabled: true, ee_sources: ['xtm_sublicense'], xtm_license_pem: license(['instance-1']) });

    await registerWithXtmOne(SETTINGS, db);

    expect(grantRemoteEntitlement).toHaveBeenCalledWith(notAfter + 90 * DAY, notAfter, 'standard');
    expect(logWarn).not.toHaveBeenCalled();
  });

  it('checks the license against the id this instance registers with', async () => {
    respondWith({ status: 'active', ee_enabled: true, ee_sources: ['xtm_sublicense'], xtm_license_pem: license(['instance-2']) });

    await registerWithXtmOne(SETTINGS, db);

    expect(grantRemoteEntitlement).toHaveBeenCalledWith(0, null, null);
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('it neither sub-licenses this platform (instance-1)'));
  });

  it('opens a ci license at the creation of this instance', async () => {
    instance = { instanceId: 'instance-1', createdAt: Date.now() - DAY };
    respondWith({ status: 'active', ee_enabled: true, ee_sources: ['xtm_sublicense'], xtm_license_pem: license(['global'], 'ci') });

    await registerWithXtmOne(SETTINGS, db);

    expect(grantRemoteEntitlement).toHaveBeenCalledWith(0, null, null);
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('this ci license expired'));
  });

  it('revokes it when XTM One explicitly answers false', async () => {
    respondWith({ status: 'ok', ee_enabled: false, ee_sources: [], xtm_license_pem: null });

    await registerWithXtmOne(SETTINGS, db);

    expect(grantRemoteEntitlement).toHaveBeenCalledWith(0, null, null);
    expect(logWarn).not.toHaveBeenCalled();
  });

  it('revokes it when the field is absent, rather than assuming entitlement', async () => {
    respondWith({ status: 'ok' });

    await registerWithXtmOne(SETTINGS, db);

    expect(grantRemoteEntitlement).toHaveBeenCalledWith(0, null, null);
  });

  it('reports a refusal once, not on every heartbeat repeating it', async () => {
    const unproven = { status: 'active', ee_enabled: true };
    const proven = { ...unproven, ee_sources: ['xtm_sublicense'], xtm_license_pem: license(['global']) };

    for (const answer of [unproven, unproven, proven, unproven]) {
      respondWith(answer);
      await registerWithXtmOne(SETTINGS, db);
    }

    // Once when the refusal starts, once more when it comes back after a verified answer.
    expect(logWarn).toHaveBeenCalledTimes(2);
  });

  it('reports again when the cause of the refusal changes, and stays quiet while it repeats', async () => {
    const outdated = { status: 'active', ee_enabled: true };
    const defaultToken = { ...outdated, ee_sources: ['xtm_sublicense'], xtm_license_withheld_reason: 'registration_token_published_default' };

    for (const answer of [outdated, defaultToken, defaultToken]) {
      respondWith(answer);
      await registerWithXtmOne(SETTINGS, db);
    }

    expect(logWarn).toHaveBeenCalledTimes(2);
    expect(logWarn).toHaveBeenNthCalledWith(1, expect.stringContaining('upgrade XTM One to a release that returns xtm_license_pem'));
    expect(logWarn).toHaveBeenNthCalledWith(2, expect.stringContaining('published default registration token'));
  });

  it('leaves the entitlement untouched when the request fails, so it lapses on its own expiry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    const result = await registerWithXtmOne(SETTINGS, db);

    expect(result).toBeNull();
    // Writing here would revoke a live grant on a transient outage; letting the
    // stored expiry run out is what fails closed without flapping.
    expect(grantRemoteEntitlement).not.toHaveBeenCalled();
  });

  it('leaves it untouched when XTM One answers a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) }));

    await registerWithXtmOne(SETTINGS, db);

    expect(grantRemoteEntitlement).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-boolean ee_enabled', () => respondWith({ ee_enabled: 'yes-please' })],
    ['a license that is not text', () => respondWith({ ee_enabled: true, xtm_license_pem: 42 })],
    ['a body that is not JSON', () => respondWithText('<html>Sign in</html>', 'text/html')],
  ])('leaves it untouched when the response cannot be parsed: %s', async (_label, answer) => {
    answer();

    await registerWithXtmOne(SETTINGS, db);

    expect(grantRemoteEntitlement).not.toHaveBeenCalled();
  });

  it('names the refusal of the last answer, and clears it once an answer entitles', async () => {
    respondWith({ status: 'active', ee_enabled: true });
    await registerWithXtmOne(SETTINGS, db);
    expect(getEntitlementRefusal()).toBe('xtm_one_outdated');

    respondWith({ status: 'active', ee_enabled: true, ee_sources: ['xtm_sublicense'], xtm_license_withheld_reason: 'registration_token_published_default' });
    await registerWithXtmOne(SETTINGS, db);
    expect(getEntitlementRefusal()).toBe('license_withheld_default_token');

    respondWith({ status: 'active', ee_enabled: true, ee_sources: ['xtm_sublicense'], xtm_license_pem: license(['global']) });
    await registerWithXtmOne(SETTINGS, db);
    expect(getEntitlementRefusal()).toBeNull();
  });

  it('has no refusal for an answer claiming nothing', async () => {
    respondWith({ status: 'active', ee_enabled: true });
    await registerWithXtmOne(SETTINGS, db);

    respondWith({ status: 'ok', ee_enabled: false });
    await registerWithXtmOne(SETTINGS, db);

    expect(getEntitlementRefusal()).toBeNull();
  });

  it.each([
    ['the request fails', () => vi.fn().mockRejectedValue(new Error('connection refused'))],
    ['XTM One answers a non-OK status', () => vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) })],
    ['XTM One answers a body it cannot read', () => vi.fn().mockResolvedValue(new Response('<html>Sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } }))],
  ])('keeps the previous refusal when %s', async (_label, failingFetch) => {
    respondWith({ status: 'active', ee_enabled: true });
    await registerWithXtmOne(SETTINGS, db);

    vi.stubGlobal('fetch', failingFetch());
    await registerWithXtmOne(SETTINGS, db);

    expect(getEntitlementRefusal()).toBe('xtm_one_outdated');
  });

  it('sends no license of its own: the platform id is what XTM One resolves against', async () => {
    respondWith({ status: 'ok', ee_enabled: true });

    await registerWithXtmOne(SETTINGS, db);

    const [, request] = vi.mocked(fetch).mock.calls[0];
    const body: unknown = JSON.parse(String(request?.body));
    expect(body).toMatchObject({ platform_id: 'instance-1' });
    expect(body).not.toHaveProperty('enterprise_license_pem');
  });

  it('sends the health snapshot it reads for Platform Health', async () => {
    respondWith({ status: 'ok', ee_enabled: false });
    const health = { schema_version: 1 as const, jobs: [{ kind: 'recompute', health: 'failing' }] };

    await registerWithXtmOne(SETTINGS, db, () => null, () => Promise.resolve(health));

    const [, request] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(request?.body))).toMatchObject({ health });
  });

  it('registers without a health snapshot when reading it fails, so the heartbeat never depends on it', async () => {
    respondWith({ status: 'ok', ee_enabled: false });
    logFromError.mockReset();

    const result = await registerWithXtmOne(SETTINGS, db, () => null, () => Promise.reject(new Error('jobs unreadable')));

    expect(result).not.toBeNull();
    const [, request] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(request?.body))).not.toHaveProperty('health');
    expect(logFromError).toHaveBeenCalledWith(expect.any(Error), 'XTM One health snapshot could not be read; registering without it');
  });
});

describe('XTM One registration to reachability', () => {
  beforeEach(() => {
    grantRemoteEntitlement.mockReset();
    isEnterpriseEdition.mockReset().mockReturnValue(false);
    logFromError.mockReset();
    resetXtmOneReachability();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records ok when the response is 200 with a parseable body', async () => {
    respondWith({ status: 'ok', ee_enabled: true });

    await registerWithXtmOne(SETTINGS, db);

    expect(getXtmOneReachability()).toBe('ok');
  });

  it.each([401, 403])('records refused on HTTP %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, json: () => Promise.resolve({}) }));

    await registerWithXtmOne(SETTINGS, db);

    expect(getXtmOneReachability()).toBe('refused');
  });

  it('records unreachable on a 500 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) }));

    await registerWithXtmOne(SETTINGS, db);

    expect(getXtmOneReachability()).toBe('unreachable');
  });

  it('logs the reason XTM One gives for a refused registration', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'sign_in_redirect_uris must be on the platform URL\'s origin' }), { status: 400 })));

    await registerWithXtmOne(SETTINGS, db);

    expect(logFromError).toHaveBeenCalledWith(expect.any(Error), 'XTM One registration failed', {
      status: 400,
      detail: 'sign_in_redirect_uris must be on the platform URL\'s origin',
    });
  });

  it('logs no validation error list, which can quote the license sent', async () => {
    const detail = [{ loc: ['body', 'enterprise_license_pem'], msg: 'Invalid', input: '-----BEGIN CERTIFICATE-----' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail }), { status: 422 })));

    await registerWithXtmOne(SETTINGS, db);

    expect(logFromError).toHaveBeenCalledWith(expect.any(Error), 'XTM One registration failed', { status: 422 });
  });

  it('logs the status alone when the refusal has no readable reason', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 })));

    await registerWithXtmOne(SETTINGS, db);

    expect(logFromError).toHaveBeenCalledWith(expect.any(Error), 'XTM One registration failed', { status: 502 });
  });

  it('records unreachable when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    await registerWithXtmOne(SETTINGS, db);

    expect(getXtmOneReachability()).toBe('unreachable');
  });

  it('records unreadable when the 200 body does not match the expected answer, logging the failing field', async () => {
    respondWith({ ee_enabled: 'yes-please' });

    await registerWithXtmOne(SETTINGS, db);

    expect(getXtmOneReachability()).toBe('unreadable');
    expect(logFromError).toHaveBeenCalledWith(expect.any(Error), expect.any(String), { issues: expect.stringContaining('ee_enabled') });
  });

  it('records unreadable when the 200 body is not JSON, without logging any of it', async () => {
    respondWithText('<html><body>Sign in to continue</body></html>', 'text/html');

    await registerWithXtmOne(SETTINGS, db);

    expect(getXtmOneReachability()).toBe('unreadable');
    expect(logFromError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logFromError.mock.calls[0], (_key, value: unknown) => (value instanceof Error ? value.message : value))).not.toContain('<html');
  });

  it('records unreachable when reading the 200 body fails', async () => {
    const timeout = () => Promise.reject(new DOMException('timeout', 'TimeoutError'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: timeout, json: timeout }));

    await registerWithXtmOne(SETTINGS, db);

    expect(getXtmOneReachability()).toBe('unreachable');
  });

  it('records nothing when the failure happens before the request is sent', async () => {
    ensureInstance.mockRejectedValueOnce(new Error('database unavailable'));

    await registerWithXtmOne(SETTINGS, db);

    expect(getXtmOneReachability()).toBe('pending');
  });
});

describe('XTM One registration of the procedure manifest', () => {
  const manifest = {
    formatVersion: 1,
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    procedures: [{ path: 'health', type: 'query' as const, input: null }],
    fingerprint: 'b'.repeat(64),
  };
  const bodies = () => vi.mocked(fetch).mock.calls.map(([, request]) => z.record(z.string(), z.unknown()).parse(JSON.parse(String(request?.body))));

  const answerWith = (...answers: Array<unknown>) => {
    const fetchMock = vi.fn();
    for (const answer of answers) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    vi.stubGlobal('fetch', fetchMock);
  };

  beforeEach(() => {
    grantRemoteEntitlement.mockReset();
    isEnterpriseEdition.mockReset().mockReturnValue(false);
    resetXtmOneReachability();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers once, with the fingerprint only, when XTM One holds the manifest', async () => {
    answerWith({ status: 'ok' });

    await registerWithXtmOne(SETTINGS, db, () => manifest);

    expect(bodies()).toHaveLength(1);
    expect(bodies()[0]).toMatchObject({ procedure_manifest_fingerprint: manifest.fingerprint });
    expect(bodies()[0]).not.toHaveProperty('procedure_manifest');
  });

  it('registers again at once with the manifest when XTM One asks for it', async () => {
    answerWith({ status: 'ok', procedure_manifest_wanted: true }, { status: 'ok' });

    await registerWithXtmOne(SETTINGS, db, () => manifest);

    expect(bodies()).toHaveLength(2);
    expect(bodies()[1]).toEqual({
      ...bodies()[0],
      procedure_manifest: { formatVersion: 1, jsonSchemaDialect: manifest.jsonSchemaDialect, procedures: manifest.procedures },
    });
  });

  it('does not register a third time when the follow-up asks again', async () => {
    answerWith({ status: 'ok', procedure_manifest_wanted: true }, { status: 'ok', procedure_manifest_wanted: true });

    await registerWithXtmOne(SETTINGS, db, () => manifest);

    expect(bodies()).toHaveLength(2);
  });

  it('registers once when XTM One does not ask', async () => {
    answerWith({ status: 'ok', procedure_manifest_wanted: false });

    await registerWithXtmOne(SETTINGS, db, () => manifest);

    expect(bodies()).toHaveLength(1);
  });

  it('registers once, without a fingerprint, while no manifest is available, even when asked', async () => {
    answerWith({ status: 'ok', procedure_manifest_wanted: true });

    await registerWithXtmOne(SETTINGS, db);

    expect(bodies()).toHaveLength(1);
    expect(bodies()[0]).not.toHaveProperty('procedure_manifest_fingerprint');
  });

  it('answers the heartbeat\'s result, entitlement untouched, when the follow-up fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', procedure_manifest_wanted: true }), { status: 200 }))
      .mockRejectedValueOnce(new Error('connection refused'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await registerWithXtmOne(SETTINGS, db, () => manifest);

    expect(result).toMatchObject({ status: 'ok' });
    expect(grantRemoteEntitlement).toHaveBeenCalledTimes(1);
  });

  it('reads the entitlement of the follow-up answer too', async () => {
    answerWith({ status: 'ok', procedure_manifest_wanted: true }, { status: 'active', ee_enabled: true, ee_sources: ['xtm_sublicense'], xtm_license_pem: license(['instance-1']) });

    await registerWithXtmOne(SETTINGS, db, () => manifest);

    expect(grantRemoteEntitlement).toHaveBeenLastCalledWith(notAfter + 90 * DAY, notAfter, 'standard');
  });
});

describe('Sign-in client in the registration', () => {
  const sentBody = (): Record<string, unknown> => JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls.at(-1)?.[1]?.body));
  const answer = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const manifest = { formatVersion: 1, jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema', procedures: [], fingerprint: 'c'.repeat(64) };

  beforeEach(() => {
    recordSignInClientId(null);
    respondWith({ status: 'ok', ee_enabled: false, sign_in_client_id: 'xtm-platform-opencrq' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the callback and keeps the client id', async () => {
    await registerWithXtmOne(SETTINGS, db, undefined);

    expect(sentBody().sign_in_redirect_uris).toEqual(['https://opencrq.example.com/api/auth/xtm/callback']);
    expect(getSignInClientId()).toBe('xtm-platform-opencrq');
  });

  it('leaves signing in off when the platform URL is plain http, and still registers, warning once', async () => {
    await registerWithXtmOne({ ...SETTINGS, platformUrl: 'http://opencrq.internal:3000' }, db, undefined);
    await registerWithXtmOne({ ...SETTINGS, platformUrl: 'http://opencrq.internal:3000' }, db, undefined);

    expect(sentBody()).not.toHaveProperty('sign_in_redirect_uris');
    expect(logWarn).toHaveBeenCalledTimes(1);
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('must be HTTPS'), expect.anything());
  });

  it('keeps the previous client id when no answer can be read', async () => {
    recordSignInClientId('xtm-platform-kept');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    await registerWithXtmOne(SETTINGS, db, undefined);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getSignInClientId()).toBe('xtm-platform-kept');
  });

  it('keeps the client id of the follow-up answer when XTM One asks for the procedure manifest', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(answer({ status: 'ok', procedure_manifest_wanted: true, sign_in_client_id: 'xtm-platform-first' }))
      .mockResolvedValueOnce(answer({ status: 'ok', sign_in_client_id: 'xtm-platform-follow-up' })));

    await registerWithXtmOne(SETTINGS, db, () => manifest);

    expect(sentBody().sign_in_redirect_uris).toEqual(['https://opencrq.example.com/api/auth/xtm/callback']);
    expect(getSignInClientId()).toBe('xtm-platform-follow-up');
  });

  it('keeps the client id of the first answer when the follow-up fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(answer({ status: 'ok', procedure_manifest_wanted: true, sign_in_client_id: 'xtm-platform-first' }))
      .mockRejectedValueOnce(new Error('connection refused')));

    await registerWithXtmOne(SETTINGS, db, () => manifest);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getSignInClientId()).toBe('xtm-platform-first');
  });
});
