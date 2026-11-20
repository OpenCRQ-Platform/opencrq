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

/**
 * Enterprise Edition entitlement for the whole platform - the OpenCRQ
 * counterpart of OpenCTI's `isEnterpriseEdition` and OpenAEV's
 * `EnterpriseEditionService`.
 *
 * One authority grants it: the XTM license covering this instance, which XTM
 * One returns at registration and this platform verifies against the XTM CA
 * compiled into its build (`xtm-license.ts`), never the bare `ee_enabled` that
 * comes with it. Being remote it is granted until an explicit expiry and fails
 * closed - a grant is good for `ENTERPRISE_LICENSE_VALIDITY_MS` up to the
 * license's own end, every successful heartbeat renews it, a revocation lapses
 * it on the next one, and a persistent outage lets it expire rather than
 * keeping the last known answer alive indefinitely. The expiry is a wall-clock
 * instant rather than a TTL because it is relayed to processes that never
 * spoke to the granter.
 *
 * Kept synchronous on purpose: the tRPC gate, the Fastify chat routes and the
 * telemetry gauge all need the answer without awaiting anything.
 */

import type { XtmLicenseType } from './xtm-license';

export type Edition = 'ce' | 'ee';

/**
 * How long a verified XTM license keeps entitling the platform without a
 * further answer from XTM One. In memory only, so a restart always starts from
 * a fresh verification.
 */
export const ENTERPRISE_LICENSE_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

let remoteEntitledUntil = 0;
let remoteLicenseExpiresAt: number | null = null;
let remoteLicenseType: XtmLicenseType | null = null;

/**
 * The second authority: a Filigran license installed on this platform directly
 * (`edition-license.ts`), verified by the same check as XTM One's answer. It
 * lasts until the license's own end; removing the license revokes it.
 */
let localEntitledUntil = 0;
let localLicenseExpiresAt: number | null = null;
let localLicenseType: XtmLicenseType | null = null;

type EditionLicenseSource = 'local' | 'remote';

/**
 * The instant the grant lapses, as epoch milliseconds. `0` (or any past
 * instant) means no entitlement. `licenseExpiresAt` and `licenseType` describe
 * the license behind it, `null` for a grant no license proves.
 */
export const setRemoteEntitlementExpiry = (
  expiresAt: number,
  licenseExpiresAt: number | null = null,
  licenseType: XtmLicenseType | null = null,
): void => {
  remoteEntitledUntil = expiresAt;
  remoteLicenseExpiresAt = licenseExpiresAt;
  remoteLicenseType = licenseType;
};

export const setLocalEntitlementExpiry = (
  expiresAt: number,
  licenseExpiresAt: number | null = null,
  licenseType: XtmLicenseType | null = null,
): void => {
  localEntitledUntil = expiresAt;
  localLicenseExpiresAt = licenseExpiresAt;
  localLicenseType = licenseType;
};

const isRemoteEntitled = (): boolean => Date.now() < remoteEntitledUntil;
const isLocalEntitled = (): boolean => Date.now() < localEntitledUntil;

export const isEnterpriseEdition = (): boolean => isRemoteEntitled() || isLocalEntitled();

/**
 * Which grant entitles the platform right now: XTM One's when it does, the
 * installed Filigran license otherwise, `null` for Community Edition.
 */
export const getEditionLicenseSource = (): EditionLicenseSource | null => {
  if (isRemoteEntitled()) {
    return 'remote';
  }
  return isLocalEntitled() ? 'local' : null;
};

export const getEdition = (): Edition => (isEnterpriseEdition() ? 'ee' : 'ce');

/**
 * The instant Enterprise Edition lapses without a further answer - the
 * validity window or the license's own end, whichever comes first - or `null`
 * when it is not granted right now. The development build's
 * `Number.MAX_SAFE_INTEGER` override surfaces unchanged.
 */
export const getEnterpriseEditionEnd = (): number | null => {
  const remote = isRemoteEntitled() ? remoteEntitledUntil : 0;
  const local = isLocalEntitled() ? localEntitledUntil : 0;
  const end = Math.max(remote, local);
  return end > 0 ? end : null;
};

/** When the license behind the current grant says it expires, or `null` without one. */
export const getLicenseExpiry = (): number | null => {
  switch (getEditionLicenseSource()) {
    case 'remote':
      return remoteLicenseExpiresAt;
    case 'local':
      return localLicenseExpiresAt;
    case null:
      return null;
  }
};

export const getLicenseType = (): XtmLicenseType | null => {
  switch (getEditionLicenseSource()) {
    case 'remote':
      return remoteLicenseType;
    case 'local':
      return localLicenseType;
    case null:
      return null;
  }
};

/**
 * Whether a first resolution is still pending.
 *
 * `boot.ts` runs every engine's `onEnginesStarted` concurrently, and the HTTP
 * engine starts listening inside its own, so without this an entitled
 * deployment would answer its first requests as Community Edition while the
 * registration that decides the edition was still in flight. A gate awaits
 * this instead of reading a value that is not decided yet.
 *
 * Only a process expecting a grant begins a resolution: where nothing will
 * ever answer, the edition is settled from the start and awaiting it is a
 * no-op rather than a hang.
 */
let editionResolved = true;
let signalResolved: (() => void) | undefined;
let resolution: Promise<void> = Promise.resolve();

export const beginEditionResolution = (): void => {
  if (!editionResolved) {
    return;
  }
  editionResolved = false;
  resolution = new Promise((resolve) => {
    signalResolved = resolve;
  });
};

export const markEditionResolved = (): void => {
  editionResolved = true;
  signalResolved?.();
  signalResolved = undefined;
};

export const isEditionResolutionPending = (): boolean => !editionResolved;

export const whenEditionResolved = (): Promise<void> => resolution;

/** Test-only reset: back to the fail-closed default, settled. */
export const resetEditionState = (): void => {
  remoteEntitledUntil = 0;
  remoteLicenseExpiresAt = null;
  remoteLicenseType = null;
  localEntitledUntil = 0;
  localLicenseExpiresAt = null;
  localLicenseType = null;
  editionResolved = true;
  signalResolved = undefined;
  resolution = Promise.resolve();
};
