import { z } from 'zod';
import type { ProtectedProcedure } from '../../trpc';
import { router } from '../../trpc';
import { getEntitlementRefusal } from './xtm-one-client';
import { getXtmOneSettings } from './xtm-one-config';
import { resolveXtmOneIdentity } from './xtm-one-identity';
import { getXtmOneFailingSince, getXtmOneLastAnswerAt, getXtmOneReachability, XTM_ONE_REACHABILITY } from './xtm-one-reachability';
import { XTM_ONE_ENTITLEMENT_REFUSALS } from './xtm-one-registration';

const toDate = (instant: number | null): Date | null => (instant !== null ? new Date(instant) : null);

/**
 * Frontend-facing XTM One connection status - powers the "Ask Ariane"
 * launcher gate (mirrors OpenAEV's `platform_xtm_one_configured` /
 * `platform_xtm_one_url` settings exposure) and the connectivity toast. The
 * token is never exposed.
 *
 * The Enterprise Edition entitlement itself is NOT reported here: it is
 * platform-wide and the frontend reads it from the edition on `authStatus`,
 * which the launcher combines with this. What this reports is why XTM One's
 * answer did not prove it, a property of the XTM One connection that must not
 * ride on `authStatus`, served before login.
 *
 * `url` is where a browser opens XTM One (its links, its MCP endpoint): the
 * identity it publishes, not `xtm_one.url`, which may be an internal address
 * only this backend reaches.
 */
export const xtmOneRouter = (protectedProcedure: ProtectedProcedure) => router({
  getSettings: protectedProcedure
    .meta({ reads: [] })
    .output(z.object({
      configured: z.boolean(),
      url: z.string().nullable(),
      entitlementRefusal: z.enum(XTM_ONE_ENTITLEMENT_REFUSALS).nullable(),
      registration: z.enum(XTM_ONE_REACHABILITY).nullable(),
      failingSince: z.date().nullable(),
      lastAnsweredAt: z.date().nullable(),
    }))
    .query(async () => {
      const settings = getXtmOneSettings();
      return {
        configured: settings !== null,
        url: settings ? await resolveXtmOneIdentity(settings) : null,
        entitlementRefusal: getEntitlementRefusal(),
        registration: settings !== null ? getXtmOneReachability() : null,
        failingSince: settings !== null ? toDate(getXtmOneFailingSince()) : null,
        lastAnsweredAt: settings !== null ? toDate(getXtmOneLastAnswerAt()) : null,
      };
    }),
});

/** Root-level wrapper merged into the app router (key: `xtmOne`). */
export const xtmOneRootRouter = (protectedProcedure: ProtectedProcedure) => router({
  xtmOne: xtmOneRouter(protectedProcedure),
});

export type XtmOneRootRouter = ReturnType<typeof xtmOneRootRouter>;
