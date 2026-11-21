import { afterEach, describe, expect, it, vi } from 'vitest';
import type { XtmLicenseContext } from '../edition/xtm-license';
import type { XtmOneSettings } from './xtm-one-config';
import { createTestXtmCa, issueTestXtmLicense, xtmLicenseExtensions } from '../edition/xtm-license-fixtures';

// Licenses are signed by a CA of the test's own, standing in for the XTM CA pinned in the build.
const ca = await vi.hoisted(async () => {
  const fixtures = await import('../edition/xtm-license-fixtures');
  return fixtures.createTestXtmCa();
});
vi.mock('../edition/xtm-ca', () => ({ XTM_CA_PEM: ca.certificatePem }));

const { buildRegistrationBody, buildRegistrationHealth, DECLARED_INTENTS, MAX_HEALTH_JOBS, procedureManifestPayload, readRegistrationEntitlement, registrationResultSchema } = await import('./xtm-one-registration');
const { platformIdentityHeaders } = await import('./xtm-one-headers');

const SETTINGS: XtmOneSettings = {
  url: 'https://xtm-one.example.com',
  token: 'registration-token',
  platformUrl: 'https://opencrq.example.com',
};

const MANIFEST = {
  formatVersion: 1,
  jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
  procedures: [{ path: 'health', type: 'query' as const, input: null }],
  fingerprint: 'a'.repeat(64),
};
const WITHOUT_MANIFEST = { supportsApprovalPrompts: true, procedureManifest: null };

describe('XTM One registration payload', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('declares the platform identity, its version, crq vertical, and intents', () => {
    vi.stubEnv('APP_VERSION', '0.261112.0-dev.0fed327');
    const body = buildRegistrationBody(SETTINGS, 'instance-1', { ...WITHOUT_MANIFEST, supportsApprovalPrompts: true });
    expect(body).toMatchObject({
      platform_identifier: 'opencrq',
      platform_url: 'https://opencrq.example.com',
      platform_version: '0.261112.0-dev.0fed327',
      platform_title: 'OpenCRQ',
      platform_id: 'instance-1',
      business_vertical: 'crq',
      intents: DECLARED_INTENTS,
    });
    // The platform carries no license of its own: XTM One resolves the
    // contract from the platform id alone.
    expect(body).not.toHaveProperty('enterprise_license_pem');
    expect(body).not.toHaveProperty('license_type');
  });

  it('names the platform and its version in the headers of every call', () => {
    vi.stubEnv('APP_VERSION', '0.261112.0-dev.0fed327');
    expect(platformIdentityHeaders(SETTINGS)).toEqual({
      'X-Platform-Product': 'opencrq',
      'X-Platform-URL': 'https://opencrq.example.com',
      'X-Platform-Version': '0.261112.0-dev.0fed327',
    });
  });

  it('reports 0.0.0-dev from a process run from source, in the payload and the headers', () => {
    vi.stubEnv('APP_VERSION', undefined);
    expect(buildRegistrationBody(SETTINGS, 'instance-1', WITHOUT_MANIFEST).platform_version).toBe('0.0.0-dev');
    expect(platformIdentityHeaders(SETTINGS)['X-Platform-Version']).toBe('0.0.0-dev');
  });

  it('declares whether Ask Ariane can collect a tool-approval verdict', () => {
    // Without the EE entitlement every chat route answers 403, so nothing
    // could answer a prompt - XTM One must not gate OpenCRQ tools then.
    expect(buildRegistrationBody(SETTINGS, 'instance-1', { ...WITHOUT_MANIFEST, supportsApprovalPrompts: false }))
      .toMatchObject({ supports_approval_prompts: false });
    expect(buildRegistrationBody(SETTINGS, 'instance-1', { ...WITHOUT_MANIFEST, supportsApprovalPrompts: true }))
      .toMatchObject({ supports_approval_prompts: true });
  });
  it('asks for a sign-in client only when signing in with XTM One is on', () => {
    const callback = 'https://opencrq.example.com/api/auth/xtm/callback';

    expect(buildRegistrationBody(SETTINGS, 'instance-1', WITHOUT_MANIFEST))
      .not.toHaveProperty('sign_in_redirect_uris');
    expect(buildRegistrationBody(SETTINGS, 'instance-1', { ...WITHOUT_MANIFEST, signInRedirectUri: callback }))
      .toMatchObject({ sign_in_redirect_uris: [callback] });
  });

  it('carries the health snapshot when one was read, and nothing when none was', () => {
    const health = buildRegistrationHealth([{ kind: 'recompute', health: 'failing' }]);

    expect(buildRegistrationBody(SETTINGS, 'instance-1', { ...WITHOUT_MANIFEST, health }))
      .toMatchObject({ health: { schema_version: 1, jobs: [{ kind: 'recompute', health: 'failing' }] } });
    expect(buildRegistrationBody(SETTINGS, 'instance-1', { ...WITHOUT_MANIFEST, health: null }))
      .not.toHaveProperty('health');
    expect(buildRegistrationBody(SETTINGS, 'instance-1', WITHOUT_MANIFEST)).not.toHaveProperty('health');
  });

  it('bounds the job kinds of the health snapshot to what XTM One keeps', () => {
    const jobs = Array.from({ length: MAX_HEALTH_JOBS + 5 }, (_, index) => ({ kind: `kind-${index}`, health: 'healthy' }));

    expect(buildRegistrationHealth(jobs).jobs).toHaveLength(MAX_HEALTH_JOBS);
  });

  it('reads the sign-in client id XTM One answers, and its absence from an older XTM One', () => {
    expect(registrationResultSchema.parse({ status: 'active', sign_in_client_id: 'xtm-platform-opencrq' }).sign_in_client_id)
      .toBe('xtm-platform-opencrq');
    expect(registrationResultSchema.parse({ status: 'active' }).sign_in_client_id).toBeUndefined();
    expect(registrationResultSchema.parse({ status: 'active', sign_in_client_id: 42 }).sign_in_client_id).toBeNull();
  });
});

describe('XTM One registration payload procedure manifest', () => {
  it('should carry the fingerprint, not the manifest', () => {
    const body = buildRegistrationBody(SETTINGS, 'instance-1', { ...WITHOUT_MANIFEST, procedureManifest: MANIFEST });

    expect(body).toMatchObject({ procedure_manifest_fingerprint: MANIFEST.fingerprint });
    expect(body).not.toHaveProperty('procedure_manifest');
  });

  it('should carry the manifest without its fingerprint when XTM One asked for it', () => {
    expect(procedureManifestPayload(MANIFEST)).toEqual({ formatVersion: 1, jsonSchemaDialect: MANIFEST.jsonSchemaDialect, procedures: MANIFEST.procedures });
  });

  it('should omit the fingerprint while no router is published', () => {
    const body = buildRegistrationBody(SETTINGS, 'instance-1', WITHOUT_MANIFEST);

    expect(body).not.toHaveProperty('procedure_manifest_fingerprint');
  });

  it('should read procedure_manifest_wanted, and a malformed one as absent', () => {
    expect(registrationResultSchema.parse({ procedure_manifest_wanted: true }).procedure_manifest_wanted).toBe(true);
    expect(registrationResultSchema.parse({ procedure_manifest_wanted: 'yes' }).procedure_manifest_wanted).toBeUndefined();
    expect(registrationResultSchema.parse({}).procedure_manifest_wanted).toBeUndefined();
  });
});

describe('what a registration answer proves', () => {
  const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
  const DAY = 24 * 60 * 60_000;
  const context: XtmLicenseContext = { platformId: 'instance-1', instanceCreatedAt: NOW - DAY, now: NOW };
  const licensed = (opencrqIds: Array<string>) => issueTestXtmLicense(ca, {
    notBefore: NOW - DAY,
    notAfter: NOW + 30 * DAY,
    extensions: xtmLicenseExtensions({ opencrqIds }),
  });
  // The five fields every XTM One answered before the license travelled with them.
  const historical = { status: 'active', platform_identifier: 'opencrq', user_integrations: 1, version: '1.260917.0' };

  it('grants nothing from ee_enabled alone, and names the XTM One upgrade', () => {
    expect(readRegistrationEntitlement({ ...historical, ee_enabled: true }, context)).toEqual({
      entitledUntil: 0,
      licenseExpiresAt: null,
      licenseType: null,
      refusal: { code: 'xtm_one_outdated', message: expect.stringContaining('upgrade XTM One to a release that returns xtm_license_pem') },
    });
  });

  it('grants the Enterprise Edition a verified license proves, until it expires', () => {
    const answer = { ...historical, ee_enabled: true, ee_sources: ['xtm_sublicense'], xtm_license_pem: licensed(['instance-1']) };
    expect(readRegistrationEntitlement(answer, context)).toEqual({ entitledUntil: NOW + 30 * DAY + 90 * DAY, licenseExpiresAt: NOW + 30 * DAY, licenseType: 'standard', refusal: null });
  });

  it('decides on the license, whatever ee_enabled says beside it', () => {
    const answer = { ...historical, ee_enabled: false, ee_sources: [], xtm_license_pem: licensed(['global']) };
    expect(readRegistrationEntitlement(answer, context).entitledUntil).toBe(NOW + 30 * DAY + 90 * DAY);
  });

  it('refuses a license that does not entitle this platform, and says why', () => {
    const answer = { ...historical, ee_enabled: true, ee_sources: ['xtm_sublicense'], xtm_license_pem: licensed(['instance-2']) };
    expect(readRegistrationEntitlement(answer, context)).toEqual({
      entitledUntil: 0,
      licenseExpiresAt: null,
      licenseType: null,
      refusal: {
        code: 'license_invalid',
        message: 'XTM One returned an XTM license that does not entitle this platform, so it stays in Community Edition: it neither sub-licenses this platform (instance-1) nor every platform ("global")',
      },
    });
  });

  it('refuses a license signed by anyone but the pinned CA', () => {
    const forged = issueTestXtmLicense(createTestXtmCa('Forger'), { notBefore: NOW - DAY, notAfter: NOW + DAY, extensions: xtmLicenseExtensions() });
    const answer = { ...historical, ee_enabled: true, ee_sources: ['xtm_sublicense'], xtm_license_pem: forged };
    expect(readRegistrationEntitlement(answer, context)).toMatchObject({
      entitledUntil: 0,
      licenseExpiresAt: null,
      licenseType: null,
      refusal: { code: 'license_untrusted', message: expect.stringContaining('its signature does not verify against the XTM CA') },
    });
  });

  it('names the sources a current XTM One claims when no license backs them', () => {
    expect(readRegistrationEntitlement({ ...historical, ee_enabled: true, ee_sources: ['platform_license'], xtm_license_pem: null }, context)).toEqual({
      entitledUntil: 0,
      licenseExpiresAt: null,
      licenseType: null,
      refusal: {
        code: 'license_missing',
        message: 'XTM One reports Enterprise Edition through platform_license without returning an XTM license sub-licensing this platform, the only proof it accepts, so the platform stays in Community Edition',
      },
    });
  });

  it.each([
    ['a string', 'xtm_sublicense'],
    ['an array of numbers', [1, 2]],
  ])('keeps a valid license entitling when ee_sources is %s', (_label, eeSources) => {
    const answer = { ...historical, ee_enabled: true, ee_sources: eeSources, xtm_license_pem: licensed(['instance-1']) };
    const parsed = registrationResultSchema.parse(answer);
    expect(readRegistrationEntitlement(parsed, context)).toEqual({ entitledUntil: NOW + 30 * DAY + 90 * DAY, licenseExpiresAt: NOW + 30 * DAY, licenseType: 'standard', refusal: null });
  });

  it.each([
    ['a string', 'xtm_sublicense'],
    ['an array of numbers', [1, 2]],
    ['null', null],
  ])('reads a malformed ee_sources (%s) without a license as no source, not as an outdated XTM One', (_label, eeSources) => {
    const parsed = registrationResultSchema.parse({ ...historical, ee_enabled: true, ee_sources: eeSources });
    expect(parsed.ee_sources).toEqual([]);
    expect(readRegistrationEntitlement(parsed, context)).toMatchObject({
      entitledUntil: 0,
      licenseExpiresAt: null,
      licenseType: null,
      refusal: { code: 'license_missing', message: expect.stringContaining('through no source') },
    });
  });

  it('names the default registration token when XTM One withholds the license because of it', () => {
    const answer = {
      ...historical,
      ee_enabled: true,
      ee_sources: ['xtm_sublicense'],
      xtm_license_pem: null,
      xtm_license_withheld_reason: 'registration_token_published_default',
    };
    expect(readRegistrationEntitlement(answer, context)).toMatchObject({
      entitledUntil: 0,
      licenseExpiresAt: null,
      licenseType: null,
      refusal: {
        code: 'license_withheld_default_token',
        message: expect.stringMatching(/PLATFORM_REGISTRATION_TOKEN.*XTM_ONE__TOKEN/),
      },
    });
  });

  it('refuses on any other withheld reason, and quotes it', () => {
    const answer = { ...historical, ee_enabled: true, ee_sources: ['xtm_sublicense'], xtm_license_withheld_reason: 'something_new' };
    expect(readRegistrationEntitlement(answer, context)).toMatchObject({
      entitledUntil: 0,
      licenseExpiresAt: null,
      licenseType: null,
      refusal: { code: 'license_withheld', message: expect.stringContaining('(something_new)') },
    });
  });

  it('ignores a withheld reason that is not text', () => {
    const parsed = registrationResultSchema.parse({ ...historical, ee_enabled: true, ee_sources: ['xtm_sublicense'], xtm_license_withheld_reason: 42 });
    expect(parsed.xtm_license_withheld_reason).toBeNull();
    expect(readRegistrationEntitlement(parsed, context)).toMatchObject({ refusal: { code: 'license_missing' } });
  });

  it('reads an empty ee_sources as a current XTM One without proof, not as an outdated one', () => {
    expect(readRegistrationEntitlement({ ...historical, ee_enabled: true, ee_sources: [] }, context)).toMatchObject({
      entitledUntil: 0,
      licenseExpiresAt: null,
      licenseType: null,
      refusal: { code: 'license_missing' },
    });
  });

  it('claims nothing when ee_enabled is false, whatever reason is withheld beside it', () => {
    const answer = { ...historical, ee_enabled: false, xtm_license_withheld_reason: 'registration_token_published_default' };
    expect(readRegistrationEntitlement(answer, context)).toEqual({ entitledUntil: 0, licenseExpiresAt: null, licenseType: null, refusal: null });
  });

  it.each([
    ['answers false', { ...historical, ee_enabled: false, ee_sources: [], xtm_license_pem: null }],
    ['says nothing', historical],
  ])('stays quiet when XTM One %s', (_label, answer) => {
    expect(readRegistrationEntitlement(answer, context)).toEqual({ entitledUntil: 0, licenseExpiresAt: null, licenseType: null, refusal: null });
  });
});
