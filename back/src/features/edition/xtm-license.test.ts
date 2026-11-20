import { describe, expect, it, vi } from 'vitest';
import type { XtmLicenseContext } from './xtm-license';
import type { TestXtmLicenseOptions } from './xtm-license-fixtures';
import { createTestXtmCa, derToPem, issueTestXtmLicense, pemToDer, XTM_LICENSE_OIDS, xtmLicenseExtensions } from './xtm-license-fixtures';

// The rule is exercised against a CA of the test's own, standing in for the pinned one.
const ca = await vi.hoisted(async () => {
  const fixtures = await import('./xtm-license-fixtures');
  return fixtures.createTestXtmCa();
});
vi.mock('./xtm-ca', () => ({ XTM_CA_PEM: ca.certificatePem }));

const { verifyXtmLicense } = await import('./xtm-license');

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;
const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
const PLATFORM_ID = '0199a3c1-7b2e-7c4d-9f10-4e5a6b7c8d9e';
const OTHER_PLATFORM_ID = '0199a3c1-7b2e-7c4d-9f10-000000000000';

const context = (overrides: Partial<XtmLicenseContext> = {}): XtmLicenseContext => ({
  platformId: PLATFORM_ID,
  instanceCreatedAt: NOW - 10 * MINUTE,
  now: NOW,
  ...overrides,
});

const license = (overrides: Partial<TestXtmLicenseOptions> = {}): string => issueTestXtmLicense(ca, {
  notBefore: NOW - DAY,
  notAfter: NOW + 365 * DAY,
  extensions: xtmLicenseExtensions(),
  ...overrides,
});

const withoutExtension = (id: string): Record<string, string> =>
  Object.fromEntries(Object.entries(xtmLicenseExtensions()).filter(([key]) => key !== id));

const reasonFor = (pem: string, overrides: Partial<XtmLicenseContext> = {}): string => {
  const verdict = verifyXtmLicense(pem, context(overrides));
  return verdict.entitled ? 'entitled' : verdict.reason;
};

describe('XTM license verification', () => {
  describe('the sub-license', () => {
    it('entitles a platform the license covers with a global grant', () => {
      expect(verifyXtmLicense(license(), context())).toEqual({
        entitled: true,
        entitledUntil: NOW + 365 * DAY + 90 * DAY,
        expiresAt: NOW + 365 * DAY,
        type: 'standard',
      });
    });

    it('entitles a platform the license names by its own platform_id', () => {
      const pem = license({ extensions: xtmLicenseExtensions({ opencrqIds: [OTHER_PLATFORM_ID, PLATFORM_ID] }) });
      expect(verifyXtmLicense(pem, context()).entitled).toBe(true);
    });

    it('refuses a license that sub-licenses other platforms only', () => {
      const pem = license({ extensions: xtmLicenseExtensions({ opencrqIds: [OTHER_PLATFORM_ID] }) });
      expect(reasonFor(pem)).toBe(`it neither sub-licenses this platform (${PLATFORM_ID}) nor every platform ("global")`);
    });

    it('matches the platform_id case-sensitively', () => {
      const pem = license({ extensions: xtmLicenseExtensions({ opencrqIds: [PLATFORM_ID.toUpperCase(), 'GLOBAL'] }) });
      expect(verifyXtmLicense(pem, context()).entitled).toBe(false);
    });

    it("reads the OpenCRQ sub-license and no other product's", () => {
      const pem = license({
        extensions: { ...withoutExtension(XTM_LICENSE_OIDS.opencrqIds), [XTM_LICENSE_OIDS.openctiIds]: '["global"]' },
      });
      expect(verifyXtmLicense(pem, context()).entitled).toBe(false);
    });

    it.each(['{"global": true}', '"global"', 'global', '["global"', ''])('grants nothing from the sub-license %j', (value) => {
      const pem = license({ extensions: { ...xtmLicenseExtensions(), [XTM_LICENSE_OIDS.opencrqIds]: value } });
      expect(verifyXtmLicense(pem, context()).entitled).toBe(false);
    });
  });

  describe('the signature', () => {
    it('refuses a license another CA signed', () => {
      const pem = issueTestXtmLicense(createTestXtmCa('Another CA'), {
        notBefore: NOW - DAY,
        notAfter: NOW + 365 * DAY,
        extensions: xtmLicenseExtensions(),
      });
      expect(reasonFor(pem)).toBe('its signature does not verify against the XTM CA');
    });

    it('refuses a license altered after it was signed', () => {
      const genuine = pemToDer(license({ extensions: xtmLicenseExtensions({ opencrqIds: ['nobody'] }) }));
      const at = genuine.indexOf('"nobody"');
      expect(at).toBeGreaterThan(0);
      // Same length, so the certificate still parses: only the signature can tell.
      const tampered = Buffer.concat([genuine.subarray(0, at), Buffer.from('"global"'), genuine.subarray(at + 8)]);

      expect(reasonFor(derToPem(tampered))).toBe('its signature does not verify against the XTM CA');
    });

    it('marks a refusal as unsigned until the XTM CA signature verifies, and signed after', () => {
      const foreign = issueTestXtmLicense(createTestXtmCa('Another CA'), { notBefore: NOW - DAY, notAfter: NOW + 365 * DAY, extensions: xtmLicenseExtensions() });
      const expired = license({ notBefore: NOW - 400 * DAY, notAfter: NOW - 100 * DAY });

      expect(verifyXtmLicense(foreign, context())).toMatchObject({ entitled: false, signed: false });
      expect(verifyXtmLicense(derToPem(Buffer.from([0x30, 0x00])), context())).toMatchObject({ entitled: false, signed: false });
      expect(verifyXtmLicense(expired, context())).toMatchObject({ entitled: false, signed: true });
    });

    it('accepts RSASSA-PKCS1-v1_5 over SHA-512', () => {
      const pem = license({ signatureAlgorithm: { oid: '1.2.840.113549.1.1.13', digest: 'sha512' } });
      expect(verifyXtmLicense(pem, context()).entitled).toBe(true);
    });

    it('refuses a signature over SHA-1, however it verifies', () => {
      const pem = license({ signatureAlgorithm: { oid: '1.2.840.113549.1.1.5', digest: 'sha1' } });
      expect(reasonFor(pem)).toBe('it is signed with 1.2.840.113549.1.1.5, not RSASSA-PKCS1-v1_5 over SHA-2');
    });
  });

  describe('the certificate', () => {
    it.each([
      ['an empty value', ''],
      ['text', 'not a certificate'],
      ['a public key', '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----'],
      ['invalid base64', '-----BEGIN CERTIFICATE-----\nA===\n-----END CERTIFICATE-----'],
      ['an oversized value', `-----BEGIN CERTIFICATE-----\n${'A'.repeat(70_000)}\n-----END CERTIFICATE-----`],
    ])('refuses %s', (_label, pem) => {
      expect(reasonFor(pem)).toBe('it is not a single PEM certificate');
    });

    it('refuses more than one certificate', () => {
      expect(reasonFor(`${license()}${license()}`)).toBe('it is not a single PEM certificate');
    });

    it('refuses a certificate travelling with anything else', () => {
      const pem = `${license()}-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n`;
      expect(reasonFor(pem)).toBe('it is not a single PEM certificate');
    });

    it('reads a certificate surrounded by whitespace', () => {
      expect(verifyXtmLicense(`\n  ${license()}  \n`, context()).entitled).toBe(true);
    });

    it('refuses a certificate followed by other data', () => {
      const der = pemToDer(license());
      expect(reasonFor(derToPem(Buffer.concat([der, Buffer.from([0x05, 0x00])])))).toBe('the certificate cannot be read (certificate)');
    });

    it('refuses a truncated certificate', () => {
      const der = pemToDer(license());
      expect(reasonFor(derToPem(der.subarray(0, der.length - 16)))).toBe('the certificate cannot be read (truncated element)');
    });

    it('refuses an inner AlgorithmIdentifier that differs from the outer one, though the signature verifies', () => {
      const pem = license({ innerSignatureAlgorithm: { oid: '1.2.840.113549.1.1.12', digest: 'sha384' } });
      expect(reasonFor(pem)).toBe('the certificate cannot be read (signature algorithm)');
    });

    it('refuses extensions on a certificate with no version field, which is v1', () => {
      expect(reasonFor(license({ version: null }))).toBe('the certificate cannot be read (version)');
    });

    it('refuses an explicitly encoded v1, which DER writes by leaving the field out', () => {
      expect(reasonFor(license({ version: 0, extensions: {} }))).toBe('the certificate cannot be read (version)');
      expect(reasonFor(license({ version: 0 }))).toBe('the certificate cannot be read (version)');
    });

    it('refuses extensions on a v2 certificate', () => {
      expect(reasonFor(license({ version: 1 }))).toBe('the certificate cannot be read (version)');
    });

    it('refuses a version value that does not exist', () => {
      expect(reasonFor(license({ version: 3 }))).toBe('the certificate cannot be read (version)');
    });

    it('refuses a unique ID on a v1 certificate', () => {
      expect(reasonFor(license({ version: null, extensions: {}, issuerUniqueId: true }))).toBe('the certificate cannot be read (version)');
      expect(reasonFor(license({ version: null, extensions: {}, subjectUniqueId: true }))).toBe('the certificate cannot be read (version)');
    });

    it('reads a unique ID on a v2 certificate as far as its extensions, which it has none of', () => {
      const pem = license({ version: 1, extensions: {}, issuerUniqueId: true, subjectUniqueId: true });
      expect(reasonFor(pem)).toBe('it is issued for no product, not "filigran xtm"');
    });

    it('reads unique IDs alongside the extensions of a v3 certificate', () => {
      expect(verifyXtmLicense(license({ issuerUniqueId: true, subjectUniqueId: true }), context()).entitled).toBe(true);
    });

    it('refuses optional fields out of the order RFC 5280 writes them, though the signature verifies', () => {
      const pem = license({ issuerUniqueId: true, arrangeOptionalFields: (fields) => [...fields].reverse() });
      expect(reasonFor(pem)).toBe('the certificate cannot be read (tbsCertificate)');
    });

    it('refuses an optional field written twice, though the signature verifies', () => {
      const pem = license({ issuerUniqueId: true, arrangeOptionalFields: (fields) => [fields[0], ...fields] });
      expect(reasonFor(pem)).toBe('the certificate cannot be read (tbsCertificate)');
    });

    it('refuses an empty serial number', () => {
      expect(reasonFor(license({ serialNumber: Buffer.alloc(0) }))).toBe('the certificate cannot be read (serial number)');
    });

    it('refuses a certificate carrying an extension twice', () => {
      const pem = license({ extraExtensions: [[XTM_LICENSE_OIDS.opencrqIds, '["global"]']] });
      expect(reasonFor(pem)).toBe(`the certificate cannot be read (duplicate extension ${XTM_LICENSE_OIDS.opencrqIds})`);
    });
  });

  describe('the product and the type', () => {
    it('refuses a license issued for another product', () => {
      const pem = license({ extensions: { ...xtmLicenseExtensions(), [XTM_LICENSE_OIDS.product]: 'opencti' } });
      expect(reasonFor(pem)).toBe('it is issued for "opencti", not "filigran xtm"');
    });

    it('refuses a license with no product', () => {
      expect(reasonFor(license({ extensions: withoutExtension(XTM_LICENSE_OIDS.product) }))).toBe('it is issued for no product, not "filigran xtm"');
    });

    it('reads the legacy product and type when the standard ones are absent', () => {
      const pem = license({
        extensions: {
          [XTM_LICENSE_OIDS.legacyProduct]: 'filigran xtm',
          [XTM_LICENSE_OIDS.legacyType]: 'lts',
          [XTM_LICENSE_OIDS.opencrqIds]: '["global"]',
        },
      });
      expect(verifyXtmLicense(pem, context())).toEqual({ entitled: true, entitledUntil: NOW + 365 * DAY + 90 * DAY, expiresAt: NOW + 365 * DAY, type: 'lts' });
    });

    it('lets the standard product win over the legacy one', () => {
      const pem = license({
        extensions: { ...xtmLicenseExtensions(), [XTM_LICENSE_OIDS.product]: 'opencti', [XTM_LICENSE_OIDS.legacyProduct]: 'filigran xtm' },
      });
      expect(reasonFor(pem)).toBe('it is issued for "opencti", not "filigran xtm"');
    });

    it('reads an extension value wrapped in a DER string', () => {
      const wrap = (tag: number, text: string): Buffer => Buffer.concat([Buffer.from([tag, Buffer.byteLength(text)]), Buffer.from(text)]);
      const pem = license({
        extensions: {
          ...xtmLicenseExtensions(),
          [XTM_LICENSE_OIDS.product]: wrap(0x0c, 'filigran xtm'),
          [XTM_LICENSE_OIDS.type]: wrap(0x04, 'nfr'),
          [XTM_LICENSE_OIDS.opencrqIds]: wrap(0x16, '["global"]'),
        },
      });
      expect(verifyXtmLicense(pem, context())).toEqual({ entitled: true, entitledUntil: NOW + 365 * DAY + 90 * DAY, expiresAt: NOW + 365 * DAY, type: 'nfr' });
    });

    it.each([
      ['a missing type', withoutExtension(XTM_LICENSE_OIDS.type)],
      ['an empty type', { ...xtmLicenseExtensions(), [XTM_LICENSE_OIDS.type]: ' ' }],
    ])('reads %s as a trial', (_label, extensions) => {
      expect(verifyXtmLicense(license({ extensions }), context())).toEqual({ entitled: true, entitledUntil: NOW + 365 * DAY + 1, expiresAt: NOW + 365 * DAY, type: 'trial' });
    });

    it('refuses an unknown license type', () => {
      const pem = license({ extensions: xtmLicenseExtensions({ type: 'enterprise' }) });
      expect(reasonFor(pem)).toBe('its license type "enterprise" is unknown');
    });
  });

  describe('the validity dates', () => {
    describe.each(['standard', 'lts', 'nfr'])('a %s license', (type) => {
      const extensions = xtmLicenseExtensions({ type });

      it('entitles through its 90-day grace period', () => {
        const notAfter = NOW - 89 * DAY;
        expect(verifyXtmLicense(license({ notBefore: NOW - 400 * DAY, notAfter, extensions }), context())).toEqual({
          entitled: true,
          entitledUntil: notAfter + 90 * DAY,
          expiresAt: notAfter,
          type,
        });
      });

      it('stops entitling once the grace period is over', () => {
        const pem = license({ notBefore: NOW - 400 * DAY, notAfter: NOW - 90 * DAY, extensions });
        expect(reasonFor(pem)).toBe(`this ${type} license expired on 2026-09-26T12:00:00Z`);
      });

      it('entitles before its notBefore, as XTM One does for a renewal issued early', () => {
        expect(verifyXtmLicense(license({ notBefore: NOW + 10 * DAY, notAfter: NOW + 375 * DAY, extensions }), context()).entitled).toBe(true);
      });
    });

    describe('a trial license', () => {
      const extensions = xtmLicenseExtensions({ type: 'trial' });

      it('entitles up to and including its notAfter', () => {
        expect(verifyXtmLicense(license({ notAfter: NOW, extensions }), context())).toEqual({
          entitled: true,
          entitledUntil: NOW + 1,
          expiresAt: NOW,
          type: 'trial',
        });
      });

      it('has no grace period', () => {
        expect(reasonFor(license({ notAfter: NOW - SECOND, extensions }))).toBe('this trial license expired on 2026-09-26T11:59:59Z');
      });

      it('does not entitle before its notBefore', () => {
        const pem = license({ notBefore: NOW + MINUTE, extensions });
        expect(reasonFor(pem)).toBe('this trial license is not valid before 2026-09-26T12:01:00Z');
      });
    });

    describe('a ci license', () => {
      const extensions = xtmLicenseExtensions({ type: 'ci' });

      it('ends 45 minutes after this instance was created', () => {
        const instanceCreatedAt = NOW - 10 * MINUTE;
        expect(verifyXtmLicense(license({ extensions }), context({ instanceCreatedAt }))).toEqual({
          entitled: true,
          entitledUntil: instanceCreatedAt + 45 * MINUTE + 1,
          expiresAt: instanceCreatedAt + 45 * MINUTE,
          type: 'ci',
        });
        expect(reasonFor(license({ extensions }), { instanceCreatedAt, now: instanceCreatedAt + 46 * MINUTE }))
          .toBe('this ci license expired on 2026-09-26T12:35:00Z');
      });

      it('ends a year after its notBefore when that comes first', () => {
        const notBefore = NOW - 365 * DAY + 5 * MINUTE;
        expect(verifyXtmLicense(license({ notBefore, extensions }), context({ instanceCreatedAt: NOW - MINUTE }))).toMatchObject({
          entitled: true,
          entitledUntil: notBefore + 365 * DAY + 1,
          expiresAt: notBefore + 365 * DAY,
        });
      });

      it('takes no account of its own notAfter', () => {
        const pem = license({ notBefore: NOW - 2 * DAY, notAfter: NOW - DAY, extensions });
        expect(verifyXtmLicense(pem, context()).entitled).toBe(true);
      });

      it('does not entitle before its notBefore', () => {
        expect(verifyXtmLicense(license({ notBefore: NOW + MINUTE, extensions }), context()).entitled).toBe(false);
      });

      it('grants nothing when the creation of this instance is unknown', () => {
        expect(reasonFor(license({ extensions }), { instanceCreatedAt: Number.NaN }))
          .toBe('it is a ci license, and the creation of this instance is unknown');
      });
    });

    it('reads a validity date past 2049, written as a GeneralizedTime', () => {
      const notAfter = Date.UTC(2051, 0, 1);
      expect(verifyXtmLicense(license({ notAfter }), context())).toMatchObject({ entitled: true, entitledUntil: notAfter + 90 * DAY });
    });
  });
});
