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

import { TRPCError } from '@trpc/server';
import type { ProtectedProcedure } from '../../trpc';
import { isEnterpriseEdition, whenEditionResolved } from './edition-state';

/**
 * The entitlement check every EE gate shares, whatever answers the caller.
 *
 * Awaits the first resolution rather than reading a value that may not be
 * decided yet (see edition-state.ts), so an early request on a licensed
 * deployment waits a few milliseconds instead of being refused.
 */
export const requireEnterpriseEdition = async (): Promise<boolean> => {
  await whenEditionResolved();
  return isEnterpriseEdition();
};

/**
 * tRPC form of the gate - the OpenCRQ mirror of OpenCTI's
 * `checkEnterpriseEdition(context)`.
 *
 * `FORBIDDEN` rather than `PAYMENT_REQUIRED`: the caller is authenticated
 * and the request well-formed, the deployment simply is not entitled, and
 * OpenCTI answers its own EE gate the same way (`ForbiddenAccess`).
 */
export const assertEnterpriseEdition = async (feature?: string): Promise<void> => {
  if (!(await requireEnterpriseEdition())) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: feature
        ? `${feature} requires an Enterprise Edition license`
        : 'This feature requires an Enterprise Edition license',
    });
  }
};

/**
 * Declarative whole-endpoint gate, applied at the router boundary so an
 * EE-only procedure cannot forget the check:
 *
 * ```ts
 * const tenantsProcedure = enterpriseProcedure(protectedProcedure, 'Multi-tenant');
 * ```
 */
export const enterpriseProcedure = (procedure: ProtectedProcedure, feature?: string) =>
  procedure.use(async ({ next }) => {
    await assertEnterpriseEdition(feature);
    return next();
  });
