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

import type { inferRouterOutputs } from '@trpc/server';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;

export type EntitlementRefusal = NonNullable<RouterOutputs['xtmOne']['getSettings']['entitlementRefusal']>;

export type XtmOneRegistration = RouterOutputs['xtmOne']['getSettings']['registration'];

export type LicenseType = NonNullable<RouterOutputs['edition']['getStatus']['licenseType']>;

interface InstalledLicense {
  entitled: boolean,
  reason: string | null,
  expiresAt: Date | null,
  type: LicenseType | null,
}

type LicenseSource = 'local' | 'remote';

export interface ShownLicense {
  type: LicenseType | null,
  expiresAt: Date | null,
  source: LicenseSource,
}

export type LicenseMessage =
  | { kind: 'xtm-one-outage' }
  | { kind: 'refusal', refusal: EntitlementRefusal }
  | { kind: 'install-in-xtm-one' };

export interface LicenseCardInput {
  isEnterpriseEdition: boolean,
  /** `undefined` while the XTM One settings are not read yet. */
  xtmOneConfigured: boolean | undefined,
  registration: XtmOneRegistration | undefined,
  entitlementRefusal: EntitlementRefusal | null | undefined,
  status: { licenseType: LicenseType | null, licenseExpiresAt: Date | null, licenseSource: LicenseSource | null } | undefined,
  /** `undefined` for a user who does not administer the platform, `null` when none is installed. */
  installed: InstalledLicense | null | undefined,
}

const isRegistrationFailure = (registration: XtmOneRegistration | undefined): boolean =>
  registration === 'unreachable' || registration === 'unreadable' || registration === 'refused';

/** An entitling license installed here wins whatever XTM One says, since it is the one an administrator can remove. */
export const shownLicense = ({ isEnterpriseEdition, status, installed }: LicenseCardInput): ShownLicense | null => {
  if (installed?.entitled === true) {
    return { type: installed.type, expiresAt: installed.expiresAt, source: 'local' };
  }
  if (!isEnterpriseEdition || status?.licenseSource == null) {
    return null;
  }
  return { type: status.licenseType, expiresAt: status.licenseExpiresAt, source: status.licenseSource };
};

/** Why the license installed here entitles nothing, `null` when none is installed or it entitles. */
export const installedLicenseRefusal = ({ installed }: LicenseCardInput): string | null =>
  installed?.entitled === false ? installed.reason ?? '' : null;

/** What XTM One's state means for the license. Until it first answers, nothing: its answer may carry one. */
export const licenseMessage = ({ isEnterpriseEdition, xtmOneConfigured, registration, entitlementRefusal }: LicenseCardInput): LicenseMessage | null => {
  if (xtmOneConfigured !== true || registration === 'pending') {
    return null;
  }
  if (isRegistrationFailure(registration)) {
    return { kind: 'xtm-one-outage' };
  }
  if (isEnterpriseEdition) {
    return null;
  }
  if (entitlementRefusal != null) {
    return { kind: 'refusal', refusal: entitlementRefusal };
  }
  return { kind: 'install-in-xtm-one' };
};

export const xtmOneLicenseSettingsUrl = (xtmOneUrl: string): string => `${xtmOneUrl}/settings/platform`;
