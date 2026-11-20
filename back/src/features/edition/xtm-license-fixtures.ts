import { generateKeyPairSync, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

/**
 * XTM CAs and licenses minted for tests, shaped the way filigran-licenses writes them: serial
 * number 0 and each extension value the UTF-8 text itself. Every key is generated here, so no
 * Filigran key is involved in any test.
 */

export const XTM_LICENSE_OIDS = {
  type: '1.3.6.1.4.1.62944.10',
  product: '1.3.6.1.4.1.62944.20',
  openctiIds: '1.3.6.1.4.1.62944.50',
  opencrqIds: '1.3.6.1.4.1.62944.90',
  legacyType: '2.14521.4.4.10',
  legacyProduct: '2.14521.4.4.20',
} as const;

export interface SignatureAlgorithm {
  oid: string,
  digest: string,
}

export const SHA256_WITH_RSA: SignatureAlgorithm = { oid: '1.2.840.113549.1.1.11', digest: 'sha256' };

export interface TestXtmCa {
  certificatePem: string,
  privateKey: KeyObject,
  publicKey: KeyObject,
  subject: Buffer,
}

export interface TestXtmLicenseOptions {
  notBefore: number,
  notAfter: number,
  /** Extension OID to its value: text as Filigran writes it, or raw bytes for a DER-wrapped form. */
  extensions: Readonly<Record<string, string | Buffer>>,
  /** Written after `extensions`, where an OID may repeat. */
  extraExtensions?: ReadonlyArray<readonly [string, string]>,
  signatureAlgorithm?: SignatureAlgorithm,
  /** The `[0]` version value (2 is v3, the default), or null to leave the field out as DER does for v1. */
  version?: number | null,
  /** The AlgorithmIdentifier written inside the signed tbsCertificate, when it should differ from the outer one. */
  innerSignatureAlgorithm?: SignatureAlgorithm,
  issuerUniqueId?: boolean,
  subjectUniqueId?: boolean,
  /** The serial number's content octets, `[0]` (serial number 0) by default. */
  serialNumber?: Buffer,
  /** Rearranges the fields after the subject public key before the tbsCertificate is signed. */
  arrangeOptionalFields?: (fields: ReadonlyArray<Buffer>) => ReadonlyArray<Buffer>,
}

const DAY_MS = 24 * 60 * 60_000;

const encodeLength = (length: number): Buffer => {
  if (length < 0x80) {
    return Buffer.from([length]);
  }
  const octets: Array<number> = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) {
    octets.unshift(rest % 256);
  }
  return Buffer.from([0x80 + octets.length, ...octets]);
};

const tlv = (tag: number, ...content: Array<Buffer>): Buffer => {
  const body = Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), encodeLength(body.length), body]);
};

const oid = (dotted: string): Buffer => {
  const [first, second, ...rest] = dotted.split('.').map(Number);
  const octets = [first * 40 + second, ...rest].flatMap((arc) => {
    const base128 = [arc % 128];
    for (let high = Math.floor(arc / 128); high > 0; high = Math.floor(high / 128)) {
      base128.unshift((high % 128) + 0x80);
    }
    return base128;
  });
  return tlv(0x06, Buffer.from(octets));
};

/** UTCTime through 2049 and GeneralizedTime from 2050, the only encoding a certificate may use; milliseconds are dropped. */
const time = (instant: number): Buffer => {
  const digits = new Date(instant).toISOString().slice(0, 19).replace(/\D/g, '');
  const year = Number(digits.slice(0, 4));
  return year >= 1950 && year < 2050 ? tlv(0x17, Buffer.from(`${digits.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${digits}Z`));
};

const name = (attributes: ReadonlyArray<readonly [string, string]>): Buffer =>
  tlv(0x30, ...attributes.map(([type, value]) => tlv(0x31, tlv(0x30, oid(type), tlv(0x0c, Buffer.from(value))))));

const extension = (id: string, value: string | Buffer): Buffer =>
  tlv(0x30, oid(id), tlv(0x04, typeof value === 'string' ? Buffer.from(value) : value));

export const derToPem = (der: Buffer): string => {
  const lines = der.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
};

export const pemToDer = (pem: string): Buffer => Buffer.from(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, ''), 'base64');

interface CertificateFields {
  issuer: Buffer,
  subject: Buffer,
  publicKey: KeyObject,
  notBefore: number,
  notAfter: number,
  extensions: ReadonlyArray<Buffer>,
  signingKey: KeyObject,
  algorithm: SignatureAlgorithm,
  version?: number | null,
  innerAlgorithm?: SignatureAlgorithm,
  issuerUniqueId?: boolean,
  subjectUniqueId?: boolean,
  serialNumber?: Buffer,
  arrangeOptionalFields?: (fields: ReadonlyArray<Buffer>) => ReadonlyArray<Buffer>,
}

const uniqueId = (tag: number): Buffer => tlv(tag, Buffer.from([0, 0xab, 0xcd]));

const certificate = ({
  issuer, subject, publicKey, notBefore, notAfter, extensions, signingKey, algorithm,
  version = 2, innerAlgorithm = algorithm, issuerUniqueId = false, subjectUniqueId = false,
  serialNumber = Buffer.from([0]), arrangeOptionalFields = (fields) => fields,
}: CertificateFields): string => {
  const algorithmIdentifier = tlv(0x30, oid(algorithm.oid), tlv(0x05));
  const optionalFields = [
    ...(issuerUniqueId ? [uniqueId(0x81)] : []),
    ...(subjectUniqueId ? [uniqueId(0x82)] : []),
    ...(extensions.length > 0 ? [tlv(0xa3, tlv(0x30, ...extensions))] : []),
  ];
  const tbs = tlv(
    0x30,
    ...(version === null ? [] : [tlv(0xa0, tlv(0x02, Buffer.from([version])))]),
    tlv(0x02, serialNumber),
    tlv(0x30, oid(innerAlgorithm.oid), tlv(0x05)),
    issuer,
    tlv(0x30, time(notBefore), time(notAfter)),
    subject,
    publicKey.export({ type: 'spki', format: 'der' }),
    ...arrangeOptionalFields(optionalFields),
  );
  const signature = sign(algorithm.digest, tbs, signingKey);
  return derToPem(tlv(0x30, tbs, algorithmIdentifier, tlv(0x03, Buffer.from([0]), signature)));
};

export const createTestXtmCa = (commonName = 'Test XTM CA'): TestXtmCa => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const subject = name([['2.5.4.3', commonName]]);
  const now = Date.now();
  return {
    certificatePem: certificate({
      issuer: subject,
      subject,
      publicKey,
      notBefore: now - DAY_MS,
      notAfter: now + 3650 * DAY_MS,
      extensions: [],
      signingKey: privateKey,
      algorithm: SHA256_WITH_RSA,
    }),
    privateKey,
    publicKey,
    subject,
  };
};

/** The extensions of a license XTM One grants on: product, type and the OpenCRQ sub-license. */
export const xtmLicenseExtensions = (
  { type = 'standard', opencrqIds = ['global'] }: { type?: string, opencrqIds?: ReadonlyArray<string> } = {},
): Record<string, string> => ({
  [XTM_LICENSE_OIDS.product]: 'filigran xtm',
  [XTM_LICENSE_OIDS.type]: type,
  [XTM_LICENSE_OIDS.opencrqIds]: JSON.stringify(opencrqIds),
});

export const issueTestXtmLicense = (
  ca: TestXtmCa,
  {
    notBefore, notAfter, extensions, extraExtensions = [], signatureAlgorithm = SHA256_WITH_RSA, version, innerSignatureAlgorithm,
    issuerUniqueId, subjectUniqueId, serialNumber, arrangeOptionalFields,
  }: TestXtmLicenseOptions,
): string => certificate({
  issuer: ca.subject,
  subject: name([['2.5.4.10', 'Test Customer'], ['2.5.4.11', 'global'], ['2.5.4.3', 'test-license']]),
  publicKey: ca.publicKey,
  notBefore,
  notAfter,
  extensions: [
    ...Object.entries(extensions).map(([id, value]) => extension(id, value)),
    ...extraExtensions.map(([id, value]) => extension(id, value)),
  ],
  signingKey: ca.privateKey,
  algorithm: signatureAlgorithm,
  version,
  innerAlgorithm: innerSignatureAlgorithm,
  issuerUniqueId,
  subjectUniqueId,
  serialNumber,
  arrangeOptionalFields,
});
