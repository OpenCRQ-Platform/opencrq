/*
Copyright (c) 2026 Filigran SAS

This file is part of the OpenCRQ Enterprise Edition ("EE") and is
licensed under the OpenCRQ Enterprise Edition License (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://github.com/OpenCRQ-Platform/opencrq/blob/main/LICENSE

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

import { constants, createPublicKey, verify } from 'node:crypto';
import { newError, StructuredError } from '@app/utils';
import { XTM_CA_PEM } from './xtm-ca';

export const XTM_LICENSE_TYPES = ['standard', 'lts', 'trial', 'nfr', 'ci'] as const;

export type XtmLicenseType = typeof XTM_LICENSE_TYPES[number];

export type XtmLicenseVerdict =
  /** `expiresAt`: the end the license itself states, before any grace XTM One adds past it. */
  | { entitled: true, entitledUntil: number, expiresAt: number, type: XtmLicenseType }
  /** `signed`: the refused certificate is one the XTM CA signed, rather than one this build cannot trust. */
  | { entitled: false, signed: boolean, reason: string };

export interface XtmLicenseContext {
  /** The `platform_id` this platform registers with XTM One. */
  platformId: string,
  /** When this platform instance was created, epoch milliseconds: a `ci` license's window opens there. */
  instanceCreatedAt: number,
  /** Epoch milliseconds. */
  now: number,
}

const TYPE_OIDS = ['1.3.6.1.4.1.62944.10', '2.14521.4.4.10'] as const;
const PRODUCT_OIDS = ['1.3.6.1.4.1.62944.20', '2.14521.4.4.20'] as const;
/** OpenCRQ's own sub-license. */
const OPENCRQ_IDS_OID = '1.3.6.1.4.1.62944.90';
const XTM_PRODUCT = 'filigran xtm';
const GLOBAL_GRANT = 'global';
const LICENSE_TYPES: ReadonlySet<string> = new Set<XtmLicenseType>(XTM_LICENSE_TYPES);

const DAY_MS = 24 * 60 * 60_000;
/** XTM One's grace period: days, not the three calendar months of OpenCTI's own license check. */
const GRACE_PERIOD_MS = 90 * DAY_MS;
const CI_INSTANCE_WINDOW_MS = 45 * 60_000;
const CI_LICENSE_WINDOW_MS = 365 * DAY_MS;
/** Far above a real license, a few kilobytes, so that no answer can make the parse costly. */
const MAX_PEM_LENGTH = 64 * 1024;

/**
 * RSASSA-PKCS1-v1_5 over a SHA-2 digest. Filigran signs with SHA-256; PSS, SHA-1 and MD5 are refused
 * rather than honoured because a certificate declares them.
 */
const DIGEST_BY_SIGNATURE_ALGORITHM = new Map([
  ['1.2.840.113549.1.1.11', 'sha256'],
  ['1.2.840.113549.1.1.12', 'sha384'],
  ['1.2.840.113549.1.1.13', 'sha512'],
  ['1.2.840.113549.1.1.14', 'sha224'],
]);

const TAG_BOOLEAN = 0x01;
const TAG_INTEGER = 0x02;
const TAG_BIT_STRING = 0x03;
const TAG_OCTET_STRING = 0x04;
const TAG_OID = 0x06;
const TAG_SEQUENCE = 0x30;
const TAG_VERSION = 0xa0;
const VERSION_1 = 0;
const VERSION_3 = 2;
const TAG_ISSUER_UNIQUE_ID = 0x81;
const TAG_SUBJECT_UNIQUE_ID = 0x82;
const TAG_EXTENSIONS = 0xa3;
/** The tbsCertificate fields after the subject public key, in the only order a certificate may carry them. */
const OPTIONAL_FIELD_TAGS: ReadonlyArray<number> = [TAG_ISSUER_UNIQUE_ID, TAG_SUBJECT_UNIQUE_ID, TAG_EXTENSIONS];
const YEAR_DIGITS_BY_TIME_TAG = new Map([[0x17, 2], [0x18, 4]]);
/** UTF8String, PrintableString, IA5String and OCTET STRING: the wrappers XTM One reads an extension value from. */
const WRAPPING_STRING_TAGS: ReadonlySet<number> = new Set([0x0c, 0x13, 0x16, TAG_OCTET_STRING]);

const PEM_PATTERN = /^-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const TIME_PATTERN = /^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/;

const XTM_CA_KEY = createPublicKey(XTM_CA_PEM);

interface DerElement {
  tag: number,
  /** The element header included, which is what a signature covers. */
  encoded: Buffer,
  content: Buffer,
}

interface LicenseCertificate {
  signedBytes: Buffer,
  digest: string,
  signature: Buffer,
  notBefore: number,
  notAfter: number,
  extensions: ReadonlyMap<string, Buffer>,
}

const unreadable = (what: string): StructuredError => newError(`the certificate cannot be read (${what})`);

const refuse = (reason: string, signed = true): XtmLicenseVerdict => ({ entitled: false, signed, reason });

const failureReason = (error: unknown): string => (error instanceof StructuredError ? error.messageKey : 'it cannot be read as a certificate');

/** One element at `offset`, with the definite, minimal length DER requires. */
const readElement = (buffer: Buffer, offset: number): DerElement => {
  if (offset + 2 > buffer.length) {
    throw unreadable('truncated element');
  }
  const tag = buffer[offset];
  if ((tag & 0x1f) === 0x1f) {
    throw unreadable('high tag number');
  }
  let length = buffer[offset + 1];
  let contentOffset = offset + 2;
  if (length > 0x7f) {
    const lengthOctets = length & 0x7f;
    if (lengthOctets === 0 || lengthOctets > 4 || contentOffset + lengthOctets > buffer.length) {
      throw unreadable('unsupported length');
    }
    length = buffer.readUIntBE(contentOffset, lengthOctets);
    if (length < 0x80 || buffer[contentOffset] === 0) {
      throw unreadable('non-minimal length');
    }
    contentOffset += lengthOctets;
  }
  const end = contentOffset + length;
  if (end > buffer.length) {
    throw unreadable('truncated element');
  }
  return { tag, encoded: buffer.subarray(offset, end), content: buffer.subarray(contentOffset, end) };
};

/** The elements of a constructed value, which must fill its content exactly. */
const readChildren = (content: Buffer): Array<DerElement> => {
  const children: Array<DerElement> = [];
  let offset = 0;
  while (offset < content.length) {
    const child = readElement(content, offset);
    children.push(child);
    offset += child.encoded.length;
  }
  return children;
};

const expectElement = (element: DerElement | undefined, tag: number, what: string): DerElement => {
  if (!element || element.tag !== tag) {
    throw unreadable(what);
  }
  return element;
};

const decodeOid = (content: Buffer): string => {
  const arcs: Array<number> = [];
  let arc = 0;
  let pending = false;
  for (const octet of content) {
    if (!pending && octet === 0x80) {
      throw unreadable('non-minimal object identifier');
    }
    arc = arc * 128 + (octet & 0x7f);
    if (arc > Number.MAX_SAFE_INTEGER) {
      throw unreadable('object identifier arc too large');
    }
    pending = (octet & 0x80) !== 0;
    if (!pending) {
      arcs.push(arc);
      arc = 0;
    }
  }
  if (pending || arcs.length === 0) {
    throw unreadable('truncated object identifier');
  }
  const [first, ...rest] = arcs;
  const root = first < 80 ? [Math.floor(first / 40), first % 40] : [2, first - 80];
  return [...root, ...rest].join('.');
};

/** A validity bound, UTCTime or GeneralizedTime, to the second and in UTC: the only form a certificate may write it in. */
const readTime = (element: DerElement | undefined): number => {
  const yearDigits = element ? YEAR_DIGITS_BY_TIME_TAG.get(element.tag) : undefined;
  const text = element?.content.toString('latin1') ?? '';
  const match = yearDigits !== undefined && text.length === yearDigits + 11 ? TIME_PATTERN.exec(text) : null;
  if (!match) {
    throw unreadable('validity date');
  }
  const [, year, month, day, hour, minute, second] = match;
  const fullYear = yearDigits === 4 ? year : `${Number(year) < 50 ? '20' : '19'}${year}`;
  const iso = `${fullYear}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  const instant = Date.parse(iso);
  // Date.parse rolls an out-of-range field over (February 30th) where a certificate date is invalid.
  if (Number.isNaN(instant) || new Date(instant).toISOString() !== iso) {
    throw unreadable('validity date');
  }
  return instant;
};

const readExtensions = (field: DerElement | undefined): ReadonlyMap<string, Buffer> => {
  const extensions = new Map<string, Buffer>();
  if (!field) {
    return extensions;
  }
  const [list, ...unexpected] = readChildren(field.content);
  if (unexpected.length > 0) {
    throw unreadable('extensions');
  }
  for (const extension of readChildren(expectElement(list, TAG_SEQUENCE, 'extensions').content)) {
    const parts = readChildren(expectElement(extension, TAG_SEQUENCE, 'extension').content);
    if (parts.length === 3) {
      expectElement(parts[1], TAG_BOOLEAN, 'extension criticality');
    } else if (parts.length !== 2) {
      throw unreadable('extension');
    }
    const id = decodeOid(expectElement(parts[0], TAG_OID, 'extension id').content);
    if (extensions.has(id)) {
      throw unreadable(`duplicate extension ${id}`);
    }
    extensions.set(id, expectElement(parts.at(-1), TAG_OCTET_STRING, 'extension value').content);
  }
  return extensions;
};

/**
 * The `[0]` version, numbered from 0 (v1) to 2 (v3), one octet: no version has more. v1 is the default,
 * which DER leaves out, so an explicit one is refused.
 */
const readVersion = (field: DerElement | undefined): number => {
  if (!field) {
    return VERSION_1;
  }
  const [integer, ...unexpected] = readChildren(field.content);
  const { content } = expectElement(integer, TAG_INTEGER, 'version');
  if (unexpected.length > 0 || content.length !== 1 || content[0] === VERSION_1 || content[0] > VERSION_3) {
    throw unreadable('version');
  }
  return content[0];
};

/** `innerSignatureAlgorithm` is the tbsCertificate's own copy of the algorithm, which the caller compares to the outer one. */
const readTbsCertificate = (tbs: DerElement): Pick<LicenseCertificate, 'notBefore' | 'notAfter' | 'extensions'> & { innerSignatureAlgorithm: Buffer } => {
  const fields = readChildren(tbs.content);
  const versionField = fields[0]?.tag === TAG_VERSION ? fields[0] : undefined;
  const version = readVersion(versionField);
  const [serialNumber, signature, issuer, validityField, subject, publicKey, ...optional] = fields.slice(versionField ? 1 : 0);
  // Filigran licenses carry serial number 0, which certificates are not meant to: its value is not checked.
  if (expectElement(serialNumber, TAG_INTEGER, 'serial number').content.length === 0) {
    throw unreadable('serial number');
  }
  expectElement(signature, TAG_SEQUENCE, 'signature algorithm');
  expectElement(issuer, TAG_SEQUENCE, 'issuer');
  expectElement(subject, TAG_SEQUENCE, 'subject');
  expectElement(publicKey, TAG_SEQUENCE, 'subject public key');
  const [notBefore, notAfter, ...extraBounds] = readChildren(expectElement(validityField, TAG_SEQUENCE, 'validity').content);
  // Each optional field at most once and in order: an unknown tag has no place (-1) and fails too.
  let previousPlace = -1;
  for (const { tag } of optional) {
    const place = OPTIONAL_FIELD_TAGS.indexOf(tag);
    if (place <= previousPlace) {
      throw unreadable('tbsCertificate');
    }
    previousPlace = place;
  }
  if (extraBounds.length > 0) {
    throw unreadable('tbsCertificate');
  }
  const extensionsField = optional.find(({ tag }) => tag === TAG_EXTENSIONS);
  const hasUniqueId = optional.some(({ tag }) => tag !== TAG_EXTENSIONS);
  // Unique IDs need v2 or later, extensions v3.
  if ((extensionsField && version !== VERSION_3) || (hasUniqueId && version === VERSION_1)) {
    throw unreadable('version');
  }
  return { notBefore: readTime(notBefore), notAfter: readTime(notAfter), extensions: readExtensions(extensionsField), innerSignatureAlgorithm: signature.encoded };
};

/** The DER of the one PEM certificate the value must consist of, surrounding whitespace aside. */
const decodePem = (pem: string): Buffer => {
  const body = pem.length <= MAX_PEM_LENGTH ? PEM_PATTERN.exec(pem.trim())?.[1].replace(/\s/g, '') : undefined;
  if (!body || !BASE64_PATTERN.test(body)) {
    throw newError('it is not a single PEM certificate');
  }
  return Buffer.from(body, 'base64');
};

const parseCertificate = (der: Buffer): LicenseCertificate => {
  const certificate = expectElement(readElement(der, 0), TAG_SEQUENCE, 'certificate');
  const [tbs, algorithm, signatureValue, ...unexpected] = readChildren(certificate.content);
  const [algorithmId] = readChildren(expectElement(algorithm, TAG_SEQUENCE, 'signature algorithm').content);
  const signatureAlgorithm = decodeOid(expectElement(algorithmId, TAG_OID, 'signature algorithm').content);
  const signatureBits = expectElement(signatureValue, TAG_BIT_STRING, 'signature').content;
  if (certificate.encoded.length !== der.length || unexpected.length > 0 || signatureBits[0] !== 0) {
    throw unreadable('certificate');
  }
  const digest = DIGEST_BY_SIGNATURE_ALGORITHM.get(signatureAlgorithm);
  if (!digest) {
    throw newError(`it is signed with ${signatureAlgorithm}, not RSASSA-PKCS1-v1_5 over SHA-2`);
  }
  const signed = expectElement(tbs, TAG_SEQUENCE, 'tbsCertificate');
  const { innerSignatureAlgorithm, ...fields } = readTbsCertificate(signed);
  // The signed copy of the algorithm must equal the unsigned one the digest was chosen from.
  if (!innerSignatureAlgorithm.equals(algorithm.encoded)) {
    throw unreadable('signature algorithm');
  }
  return { signedBytes: signed.encoded, digest, signature: signatureBits.subarray(1), ...fields };
};

/** Filigran writes the UTF-8 text itself; XTM One also accepts it wrapped in one DER string. */
const extensionText = (value: Buffer): string => {
  const wrapped = value.length > 2 && WRAPPING_STRING_TAGS.has(value[0]) && value[1] === value.length - 2;
  return (wrapped ? value.subarray(2) : value).toString('utf8').trim();
};

/** The standard OID's value, the legacy one's only when the standard is absent. */
const readExtension = (extensions: ReadonlyMap<string, Buffer>, [standard, legacy]: readonly [string, string]): string | undefined => {
  const value = extensions.get(standard) ?? extensions.get(legacy);
  return value === undefined ? undefined : extensionText(value);
};

/** A missing extension, malformed JSON or anything but an array grants nothing. */
const readGrants = (value: Buffer | undefined): Array<string> => {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(extensionText(value));
    return Array.isArray(parsed) ? parsed.filter((grant): grant is string => typeof grant === 'string') : [];
  } catch {
    return [];
  }
};

export const isLicenseType = (value: unknown): value is XtmLicenseType => typeof value === 'string' && LICENSE_TYPES.has(value);

const formatInstant = (instant: number): string => new Date(instant).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The span a license entitles over, `end` excluded, and the end it states before any grace. */
const validity = (
  type: XtmLicenseType,
  { notBefore, notAfter }: LicenseCertificate,
  instanceCreatedAt: number,
): { start: number, end: number, expiresAt: number } => {
  switch (type) {
    case 'standard':
    case 'lts':
    case 'nfr':
      // XTM One's grace branch also covers a license whose notBefore is still ahead, so a renewal
      // issued early entitles from the day it arrives.
      return { start: Number.NEGATIVE_INFINITY, end: notAfter + GRACE_PERIOD_MS, expiresAt: notAfter };
    // XTM One's end is inclusive for the types without grace, hence the millisecond.
    case 'trial':
      return { start: notBefore, end: notAfter + 1, expiresAt: notAfter };
    case 'ci': {
      // A ci license's notAfter says nothing: its window is what ends it.
      const windowEnd = Math.min(instanceCreatedAt + CI_INSTANCE_WINDOW_MS, notBefore + CI_LICENSE_WINDOW_MS);
      return { start: notBefore, end: windowEnd + 1, expiresAt: windowEnd };
    }
  }
};

const applyLicense = (license: LicenseCertificate, { platformId, instanceCreatedAt, now }: XtmLicenseContext): XtmLicenseVerdict => {
  const product = readExtension(license.extensions, PRODUCT_OIDS);
  if (product !== XTM_PRODUCT) {
    return refuse(`it is issued for ${product ? `"${product}"` : 'no product'}, not "${XTM_PRODUCT}"`);
  }
  // An empty type is a trial as much as a missing one, hence || rather than ??.
  const type = readExtension(license.extensions, TYPE_OIDS) || 'trial';
  if (!isLicenseType(type)) {
    return refuse(`its license type "${type}" is unknown`);
  }
  if (type === 'ci' && !Number.isFinite(instanceCreatedAt)) {
    return refuse('it is a ci license, and the creation of this instance is unknown');
  }
  const { start, end, expiresAt } = validity(type, license, instanceCreatedAt);
  if (now < start) {
    return refuse(`this ${type} license is not valid before ${formatInstant(start)}`);
  }
  if (now >= end) {
    return refuse(`this ${type} license expired on ${formatInstant(end)}`);
  }
  const grants = readGrants(license.extensions.get(OPENCRQ_IDS_OID));
  if (!grants.includes(GLOBAL_GRANT) && !grants.includes(platformId)) {
    return refuse(`it neither sub-licenses this platform (${platformId}) nor every platform ("${GLOBAL_GRANT}")`);
  }
  return { entitled: true, entitledUntil: end, expiresAt, type };
};

/**
 * Whether an XTM license entitles this platform to Enterprise Edition: the check XTM One runs
 * itself, with the same outcome.
 * Verified against the XTM CA compiled into this build, and against nothing else.
 *
 * Until its signature verifies the certificate is whatever the host behind the XTM One URL sent,
 * so the reader above refuses anything it does not fully understand rather than guess. The subject
 * is not read: XTM One checks neither the customer name nor the instance the license was made for.
 */
export const verifyXtmLicense = (pem: string, context: XtmLicenseContext): XtmLicenseVerdict => {
  let license: LicenseCertificate;
  try {
    license = parseCertificate(decodePem(pem));
    const signed = verify(license.digest, license.signedBytes, { key: XTM_CA_KEY, padding: constants.RSA_PKCS1_PADDING }, license.signature);
    if (!signed) {
      return refuse('its signature does not verify against the XTM CA', false);
    }
  } catch (error) {
    return refuse(failureReason(error), false);
  }
  try {
    return applyLicense(license, context);
  } catch (error) {
    return refuse(failureReason(error));
  }
};
