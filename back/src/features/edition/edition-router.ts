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
import { createServices, platformCapabilitiesService, PlatformCapability_ManageUsers } from '@app/module';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { ProtectedProcedure } from '../../trpc';
import { router } from '../../trpc';
import { checkXtmOneRegistration } from '../xtm-one/xtm-one-check';
import { getXtmOneLastAnswerAt, XTM_ONE_REGISTRATION_OUTCOMES } from '../xtm-one/xtm-one-reachability';
import { ensureInstance } from './edition-instance';
import { describeInstalledFiligranLicense, removeFiligranLicense } from './edition-license';
import { getEdition, getEditionLicenseSource, getEnterpriseEditionEnd, getLicenseExpiry, getLicenseType, whenEditionResolved } from './edition-state';
import { XTM_LICENSE_TYPES } from './xtm-license';

// The development build's never-expiring grant lies past the last instant a Date can hold.
const toDate = (instant: number | null): Date | null => {
  const date = instant !== null ? new Date(instant) : null;
  return date !== null && !Number.isNaN(date.getTime()) ? date : null;
};

const FiligranLicenseSchema = z.object({
  entitled: z.boolean(),
  reason: z.string().nullable(),
  expiresAt: z.date().nullable(),
  type: z.enum(XTM_LICENSE_TYPES).nullable(),
});

/**
 * Frontend-facing platform edition, with two dates the detail card keeps
 * apart: `endsAt`, when Enterprise Edition lapses without a further answer
 * from XTM One, and `licenseExpiresAt`, when the license itself says it
 * expires. The card combines them with `xtmOne.getSettings` to explain *why*
 * the first one matters, which this endpoint does not know.
 *
 * `licenseSource` says which form of the Filigran license entitles the
 * platform: `remote` (distributed by XTM One at registration) or `local`
 * (installed on this platform), `null` for Community Edition.
 * `filigranLicense` describes the installed one, whether it entitles or not.
 *
 * OpenCRQ takes its Filigran license from XTM One only (Filigran License v2,
 * 17 Nov 2026): there is no way to install one here any more. A license an
 * administrator installed before keeps entitling until it expires, and can
 * still be removed; XTM One's grant cannot be removed from OpenCRQ.
 *
 * Awaits the first XTM One resolution (see edition-state.ts) so an early
 * caller reads the settled edition rather than the fail-closed default.
 *
 * Removing a previously installed Filigran license is platform administration:
 * the MANAGE_USERS platform capability that gates the rest of it. So are reading
 * the instance id, which a restricted license names, and `checkWithXtmOne`,
 * served by the process that registers with XTM One, so the edition its answer
 * applies is the one this router reads.
 */
export const editionRouter = (protectedProcedure: ProtectedProcedure, db: DrizzleDB = Object.create(null)) => {
  const platformAdminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
    const capable = await createServices([platformCapabilitiesService], db).withOrigin(ctx.origin).platformCapabilities
      .hasPlatformCapability(PlatformCapability_ManageUsers);
    if (!capable) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'The MANAGE_USERS platform capability is required' });
    }
    return next({ ctx });
  });

  return router({
    getStatus: protectedProcedure
      .meta({ reads: [] })
      .output(z.object({
        edition: z.enum(['ce', 'ee']),
        endsAt: z.date().nullable(),
        licenseExpiresAt: z.date().nullable(),
        licenseSource: z.enum(['local', 'remote']).nullable(),
        licenseType: z.enum(XTM_LICENSE_TYPES).nullable(),
      }))
      .query(async () => {
        await whenEditionResolved();
        return {
          edition: getEdition(),
          endsAt: toDate(getEnterpriseEditionEnd()),
          licenseExpiresAt: toDate(getLicenseExpiry()),
          licenseSource: getEditionLicenseSource(),
          licenseType: getLicenseType(),
        };
      }),
    getInstance: platformAdminProcedure
      .output(z.object({ instanceId: z.string() }))
      .query(async () => {
        const { instanceId } = await ensureInstance(db);
        return { instanceId };
      }),
    getFiligranLicense: platformAdminProcedure
      .output(FiligranLicenseSchema.nullable())
      .query(async () => {
        const installed = await describeInstalledFiligranLicense(db);
        return installed === null ? null : { ...installed, expiresAt: toDate(installed.expiresAt) };
      }),
    removeFiligranLicense: platformAdminProcedure
      .mutation(async () => {
        await removeFiligranLicense(db);
      }),
    checkWithXtmOne: platformAdminProcedure
      .output(z.object({
        registration: z.enum(XTM_ONE_REGISTRATION_OUTCOMES),
        failingSince: z.date().nullable(),
        lastAnsweredAt: z.date().nullable(),
      }))
      .mutation(async () => {
        const attempt = await checkXtmOneRegistration();
        if (attempt === 'not_configured') {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No XTM One is configured' });
        }
        if (attempt === 'not_sent') {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'The registration with XTM One could not be sent: the backend log gives the reason' });
        }
        return { registration: attempt.outcome, failingSince: toDate(attempt.failingSince), lastAnsweredAt: toDate(getXtmOneLastAnswerAt()) };
      }),
  });
};

/** Root-level wrapper merged into the app router (key: `edition`). */
export const editionRootRouter = (protectedProcedure: ProtectedProcedure, db?: DrizzleDB) => router({
  edition: editionRouter(protectedProcedure, db),
});

export type EditionRootRouter = ReturnType<typeof editionRootRouter>;
