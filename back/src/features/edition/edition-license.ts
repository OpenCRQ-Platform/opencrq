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

import type { DrizzleDB } from '@app/module';
import { schema } from '@app/module';
import { eq } from 'drizzle-orm';
import type { XtmLicenseType, XtmLicenseVerdict } from './xtm-license';
import { publishRemoteEntitlement } from './entitlement-ipc';
import { ensureInstance } from './edition-instance';
import { setLocalEntitlementExpiry } from './edition-state';
import { verifyXtmLicense } from './xtm-license';

/**
 * A Filigran license an administrator installed on this platform directly
 * before 17 Nov 2026. Since Filigran License v2, OpenCRQ takes its license from
 * XTM One only: nothing installs one any more, and one already installed keeps
 * entitling until it expires and can be removed. It is the same certificate
 * XTM One distributes, product claim `filigran xtm`, signed by the XTM CA and
 * verified by the very check the registration answer goes through
 * (`verifyXtmLicense`). Its OpenCRQ sub-license (OID 62944.90) must name
 * `global` or this instance id; an unchecked module writes an empty list and
 * entitles nothing.
 *
 * The PEM is kept in `platform_metadata`, the verdict never: every boot and
 * every install verifies it again, and the grant it yields lives in the
 * edition state's `local` slot, next to XTM One's `remote` one, relayed to the
 * other processes over the entitlement IPC.
 */
export const FILIGRAN_LICENSE_METADATA_KEY = 'filigran_license_pem';

interface InstalledFiligranLicense {
  /** Whether the installed license entitles this platform right now. */
  entitled: boolean,
  /** Why it does not, `null` when it does. */
  reason: string | null,
  /** When the license itself says it expires, `null` when it does not entitle. */
  expiresAt: number | null,
  /** The type the license states, `null` when it does not entitle. */
  type: XtmLicenseType | null,
}

const readInstalledPem = async (db: DrizzleDB): Promise<string | null> => {
  const rows = await db.select()
    .from(schema.platformMetadata)
    .where(eq(schema.platformMetadata.key, FILIGRAN_LICENSE_METADATA_KEY));
  return rows[0]?.value ?? null;
};

const verifyFiligranLicense = async (db: DrizzleDB, pem: string): Promise<XtmLicenseVerdict> => {
  const { instanceId, createdAt } = await ensureInstance(db);
  return verifyXtmLicense(pem.trim(), { platformId: instanceId, instanceCreatedAt: createdAt, now: Date.now() });
};

/**
 * Grants (or revokes, without an entitling verdict) the local slot in this process and, on a
 * change an administrator made, in every sibling: at boot each process reads the license itself.
 */
const applyLocalGrant = (verdict: XtmLicenseVerdict | null, relay: boolean): void => {
  const entitlement = verdict?.entitled
    ? { expiresAt: verdict.entitledUntil, licenseExpiresAt: verdict.expiresAt, licenseType: verdict.type }
    : { expiresAt: 0, licenseExpiresAt: null, licenseType: null };
  setLocalEntitlementExpiry(entitlement.expiresAt, entitlement.licenseExpiresAt, entitlement.licenseType);
  if (relay) {
    publishRemoteEntitlement({ ...entitlement, slot: 'local' });
  }
};

/** Removes the installed license and revokes the local slot; XTM One's grant, if any, is untouched. */
export const removeFiligranLicense = async (db: DrizzleDB): Promise<void> => {
  await db.delete(schema.platformMetadata).where(eq(schema.platformMetadata.key, FILIGRAN_LICENSE_METADATA_KEY));
  applyLocalGrant(null, true);
};

/** Re-verifies the installed license at boot and grants the local slot from it. */
export const loadInstalledFiligranLicense = async (db: DrizzleDB): Promise<XtmLicenseVerdict | null> => {
  const pem = await readInstalledPem(db);
  if (pem === null) {
    return null;
  }
  const verdict = await verifyFiligranLicense(db, pem);
  applyLocalGrant(verdict, false);
  return verdict;
};

/** What the administrator sees of the installed license, `null` when none is installed. */
export const describeInstalledFiligranLicense = async (db: DrizzleDB): Promise<InstalledFiligranLicense | null> => {
  const pem = await readInstalledPem(db);
  if (pem === null) {
    return null;
  }
  const verdict = await verifyFiligranLicense(db, pem);
  return verdict.entitled
    ? { entitled: true, reason: null, expiresAt: verdict.expiresAt, type: verdict.type }
    : { entitled: false, reason: verdict.reason, expiresAt: null, type: null };
};
