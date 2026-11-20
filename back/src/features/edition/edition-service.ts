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

import type { XtmLicenseType } from './xtm-license';
import { publishRemoteEntitlement } from './entitlement-ipc';
import { ENTERPRISE_LICENSE_VALIDITY_MS, markEditionResolved, setRemoteEntitlementExpiry } from './edition-state';

/**
 * Record what the remote authority proved, so processes that never speak to
 * it read the same verdict. The grant lasts until `entitledUntil`, when the
 * proof itself stops entitling the platform, or `ENTERPRISE_LICENSE_VALIDITY_MS`
 * without a further answer, whichever ends first; an answer proving nothing
 * (`0`) revokes it at once. `licenseExpiresAt` and `licenseType` describe that
 * license for administrators, never what gates.
 *
 * Only called when an answer arrived. A registration that failed - unreachable,
 * a non-OK status, an unparsable body - deliberately does not reach here: the
 * grant then lapses on its own expiry instead of being revoked mid-outage.
 *
 * An answer of either kind settles the edition: a refusal is a decision, not
 * an absence of one, and holding the gates open for it would delay every
 * early request on a Community deployment.
 */
export const grantRemoteEntitlement = (entitledUntil: number, licenseExpiresAt: number | null, licenseType: XtmLicenseType | null): void => {
  const now = Date.now();
  const expiresAt = entitledUntil > now ? Math.min(entitledUntil, now + ENTERPRISE_LICENSE_VALIDITY_MS) : 0;
  const entitled = expiresAt > 0;
  const entitlement = { expiresAt, licenseExpiresAt: entitled ? licenseExpiresAt : null, licenseType: entitled ? licenseType : null };
  setRemoteEntitlementExpiry(entitlement.expiresAt, entitlement.licenseExpiresAt, entitlement.licenseType);
  markEditionResolved();
  // Only this process registers, and every process gates on the answer.
  publishRemoteEntitlement(entitlement);
};
