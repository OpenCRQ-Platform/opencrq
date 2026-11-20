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

import { dbEngine } from '../../engines/db';
import { registerEngine } from '../../engines/engines-manager';
import { filigranTelemetryEngine } from '../../engines/filigran-telemetry';
import { createLogger } from '../../utils/logger';
import { registerFeature } from '../features-manager';
import { onRemoteEntitlement } from './entitlement-ipc';
import { loadInstalledFiligranLicense } from './edition-license';
import {
  getEdition,
  isEditionResolutionPending,
  isEnterpriseEdition,
  markEditionResolved,
  setLocalEntitlementExpiry,
  setRemoteEntitlementExpiry,
  whenEditionResolved,
} from './edition-state';
import { isLicenseType } from './xtm-license';

const EDITION_FEATURE_KEY = 'edition';

const { logTrace, logFromError } = createLogger({ feature: EDITION_FEATURE_KEY });

/**
 * How long a gate waits for the first XTM One answer before falling back to
 * the fail-closed default. The registration request is allowed 30 seconds,
 * which no login screen can be held for; past this budget the platform serves
 * Community Edition and the answer corrects it whenever it lands.
 */
const EDITION_BOOT_BUDGET_MS = 5_000;

/**
 * Resolves the platform edition. Deliberately free of any HTTP registration so
 * every process can activate it - importing the http-server engine would
 * register it, and a second process binding the API port fails to listen.
 */
const activateEdition = (): void => {
  filigranTelemetryEngine.setEditionResolver(isEnterpriseEdition);
  // Only the process that registers with XTM One hears the grant; the parent
  // relays it to the others (see entitlement-ipc).
  process.on('message', onRemoteEntitlement(({ expiresAt, licenseExpiresAt, licenseType, slot }) => {
    const type = isLicenseType(licenseType) ? licenseType : null;
    // An installed Filigran license, relayed from the process that installed or removed it, is not
    // the registration answer the gates wait for, so it settles nothing.
    if (slot === 'local') {
      setLocalEntitlementExpiry(expiresAt, licenseExpiresAt, type);
      return;
    }
    setRemoteEntitlementExpiry(expiresAt, licenseExpiresAt, type);
    markEditionResolved();
  }));

  registerEngine({
    key: EDITION_FEATURE_KEY,
    start: () => {
      let bootBudgetTimer: NodeJS.Timeout | undefined;

      return {
        onEnginesStarted: () => {
          // Every process reads the installed Filigran license itself, so none depends on a relay at boot.
          loadInstalledFiligranLicense(dbEngine.db).then((verdict) => {
            if (verdict !== null) {
              logTrace('Installed Filigran license verified', verdict.entitled ? { entitled: true } : { entitled: false, reason: verdict.reason });
            }
          }).catch((error: unknown) => {
            logFromError(error, 'Error reading the installed Filigran license');
          });
          // Nothing expects a grant here - the worker registers with nobody -
          // so the edition is already settled and there is no budget to run.
          if (!isEditionResolutionPending()) {
            return;
          }
          bootBudgetTimer = setTimeout(() => {
            markEditionResolved();
            logTrace('Enterprise edition settled on the boot budget', { edition: getEdition() });
          }, EDITION_BOOT_BUDGET_MS);
          bootBudgetTimer.unref();
          // The budget speaks only for an answer that never came.
          void whenEditionResolved().then(() => clearTimeout(bootBudgetTimer));
        },
        stop: () => {
          if (bootBudgetTimer) {
            clearTimeout(bootBudgetTimer);
          }
        },
      };
    },
  });
};

registerFeature({
  key: EDITION_FEATURE_KEY,
  activate: activateEdition,
});
