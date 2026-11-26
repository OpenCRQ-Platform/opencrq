import { z } from 'zod';
import type { ServedProcedureManifest } from '../app-router/procedure-manifest';
import type { XtmLicenseContext, XtmLicenseType } from '../edition/xtm-license';
import type { XtmOneSettings } from './xtm-one-config';
import { platformVersion } from '../../utils/platform-version';
// Direct module import: the edition barrel reaches the logger, hence the
// process config this file is kept free of.
import { verifyXtmLicense } from '../edition/xtm-license';

/**
 * Pure registration payload building and answer reading - kept free of
 * config/logger imports so both stay unit-testable without a process
 * configuration.
 */

/** Re-registration cadence - doubles as the liveness heartbeat on the XTM
 *  One side (same 5-minute schedule as OpenCTI's registration manager and
 *  OpenAEV's connectivity service). Lives here (pure module) so both the
 *  scheduler and XTM One's reachability grace (`xtm-one-reachability.ts`)
 *  derive from the same constant. */
export const REGISTRATION_INTERVAL_MS = 5 * 60_000;

/** The intent whose bound agents Ask Ariane offers. */
export const ASSISTANT_INTENT = 'global.assistant';

/**
 * Intents declared at registration: only those an OpenCRQ request looks up in
 * XTM One's intent catalog before calling the agent bound to it. XTM One shows
 * an administrator every declared intent to rebind, so one no request reads
 * offers a rebinding that changes nothing.
 */
const DECLARED_INTENTS: Array<{ name: string, description: string }> = [
  { name: ASSISTANT_INTENT, description: 'General-purpose assistant' },
];

export const registrationResultSchema = z.object({
  status: z.string().optional(),
  version: z.string().optional(),
  ee_enabled: z.boolean().optional(),
  // Both only shape the warning: a malformed value must not fail the parse
  // and drop a valid `xtm_license_pem` next to it. Only an XTM One that knows
  // `ee_sources` sends it, malformed or `null`, hence `[]` rather than absent.
  ee_sources: z.array(z.string()).optional().catch([]),
  xtm_license_pem: z.string().nullish(),
  xtm_license_withheld_reason: z.string().nullish().catch(null),
  // XTM One does not hold the reported procedure manifest fingerprint. Only decides whether to
  // register once more, so a malformed value reads as not wanted rather than failing the parse.
  procedure_manifest_wanted: z.boolean().optional().catch(undefined),
  // The OpenID Connect client XTM One keeps for this platform when it was sent
  // `sign_in_redirect_uris`; an XTM One without product sign-in never sends it.
  sign_in_client_id: z.string().nullish().catch(null),
});

export type RegistrationResult = z.infer<typeof registrationResultSchema>;

export const XTM_ONE_ENTITLEMENT_REFUSALS = [
  'xtm_one_outdated',
  'license_withheld_default_token',
  'license_withheld',
  'license_missing',
  'license_untrusted',
  'license_invalid',
] as const;

export type XtmOneEntitlementRefusal = typeof XTM_ONE_ENTITLEMENT_REFUSALS[number];

export interface RegistrationEntitlement {
  /** When the Enterprise Edition the answer proves ends, epoch milliseconds; `0` for none. */
  entitledUntil: number,
  /** When the proving license says it expires, before any grace, epoch milliseconds; `null` for none. */
  licenseExpiresAt: number | null,
  licenseType: XtmLicenseType | null,
  /** Why an answer claiming Enterprise Edition, or carrying a license, entitles nothing: a code for the UI, a message for the log. */
  refusal: { code: XtmOneEntitlementRefusal, message: string } | null,
}

/**
 * What a registration answer proves. Only `xtm_license_pem` can entitle the
 * platform, once it verifies against the XTM CA compiled into this build:
 * `ee_enabled` is whatever the host behind the XTM One URL chose to say, so
 * it only decides whether a missing proof deserves a warning. An XTM One predating that proof sends
 * neither it nor `ee_sources`.
 */
export const readRegistrationEntitlement = (result: RegistrationResult, context: XtmLicenseContext): RegistrationEntitlement => {
  if (result.xtm_license_pem) {
    const verdict = verifyXtmLicense(result.xtm_license_pem, context);
    if (verdict.entitled) {
      return { entitledUntil: verdict.entitledUntil, licenseExpiresAt: verdict.expiresAt, licenseType: verdict.type, refusal: null };
    }
    return {
      entitledUntil: 0,
      licenseExpiresAt: null,
      licenseType: null,
      refusal: verdict.signed
        ? {
          code: 'license_invalid',
          message: `XTM One returned an XTM license that does not entitle this platform, so it stays in Community Edition: ${verdict.reason}`,
        }
        : {
          code: 'license_untrusted',
          message: `XTM One returned an XTM license this platform cannot verify as signed by Filigran, so it stays in Community Edition: ${verdict.reason}`,
        },
    };
  }
  if (result.ee_enabled !== true) {
    return { entitledUntil: 0, licenseExpiresAt: null, licenseType: null, refusal: null };
  }
  const withheld = result.xtm_license_withheld_reason;
  if (withheld === 'registration_token_published_default') {
    return {
      entitledUntil: 0,
      licenseExpiresAt: null,
      licenseType: null,
      refusal: {
        code: 'license_withheld_default_token',
        message: 'XTM One withholds the XTM license because it runs with the published default registration token, so the platform stays in Community Edition: set a registration token of your own (PLATFORM_REGISTRATION_TOKEN on XTM One, the same value in XTM_ONE__TOKEN here)',
      },
    };
  }
  if (withheld) {
    return {
      entitledUntil: 0,
      licenseExpiresAt: null,
      licenseType: null,
      refusal: {
        code: 'license_withheld',
        message: `XTM One withholds the XTM license (${withheld}), so the platform stays in Community Edition`,
      },
    };
  }
  if (result.ee_sources != null) {
    return {
      entitledUntil: 0,
      licenseExpiresAt: null,
      licenseType: null,
      refusal: {
        code: 'license_missing',
        message: `XTM One reports Enterprise Edition through ${result.ee_sources.join(', ') || 'no source'} without returning an XTM license sub-licensing this platform, the only proof it accepts, so the platform stays in Community Edition`,
      },
    };
  }
  return {
    entitledUntil: 0,
    licenseExpiresAt: null,
    licenseType: null,
    refusal: {
      code: 'xtm_one_outdated',
      message: 'XTM One reports Enterprise Edition without the Filigran-signed XTM license that proves it, so the platform stays in Community Edition: upgrade XTM One to a release that returns xtm_license_pem at registration',
    },
  };
};

export interface RegistrationOptions {
  /**
   * Whether Ask Ariane can display a tool-approval prompt and collect a
   * verdict. XTM One gates the tools OpenCRQ contributes only when there is
   * somebody to ask; declaring `false` leaves the decision to an XTM One
   * administrator. Distinct from `supports_tool_approval`, the per-message
   * flag a single client sends to promise it will answer a given prompt.
   */
  supportsApprovalPrompts: boolean,
  /** What this process serves on `/trpc`; `null` while no router is published, which omits the fingerprint. */
  procedureManifest: ServedProcedureManifest | null,
  /** This platform's sign-in callback, sent when signing in with XTM One is on. */
  signInRedirectUri?: string,
  /** The health snapshot for XTM One's Platform Health; omitted when it could not be read. */
  health?: RegistrationHealth | null,
}

/** Job kinds a snapshot carries at most, the bound XTM One keeps. */
export const MAX_HEALTH_JOBS = 200;

/**
 * The `health` object of the registration, snapshot format 1 of XTM One's Platform Health
 * (`backend/app/services/health/snapshots.py`): OpenCRQ sends `jobs`, one health per job kind.
 */
export interface RegistrationHealth {
  schema_version: 1,
  jobs: Array<{ kind: string, health: string }>,
}

export const buildRegistrationHealth = (jobs: ReadonlyArray<{ kind: string, health: string }>): RegistrationHealth => ({
  schema_version: 1,
  jobs: jobs.slice(0, MAX_HEALTH_JOBS).map(({ kind, health }) => ({ kind, health })),
});

/**
 * Build the `POST /api/v1/platform/register` payload. XTM One resolves
 * whether the customer's XTM license covers this instance and, when it does,
 * returns that license for the platform to verify - the platform's only
 * source of Enterprise Edition.
 */
export const buildRegistrationBody = (
  settings: XtmOneSettings,
  instanceId: string,
  { supportsApprovalPrompts, procedureManifest, signInRedirectUri, health }: RegistrationOptions,
): Record<string, unknown> => ({
  platform_identifier: 'opencrq',
  platform_url: settings.platformUrl,
  platform_title: 'OpenCRQ',
  platform_version: platformVersion(),
  platform_id: instanceId,
  business_vertical: 'crq',
  intents: DECLARED_INTENTS,
  supports_approval_prompts: supportsApprovalPrompts,
  ...(procedureManifest && { procedure_manifest_fingerprint: procedureManifest.fingerprint }),
  ...(signInRedirectUri ? { sign_in_redirect_uris: [signInRedirectUri] } : {}),
  ...(health ? { health } : {}),
});

/** The `procedure_manifest` a registration carries when XTM One asked for it: the manifest without its fingerprint, which travels beside it. */
export const procedureManifestPayload = ({ formatVersion, jsonSchemaDialect, procedures }: ServedProcedureManifest): Record<string, unknown> => ({
  formatVersion,
  jsonSchemaDialect,
  procedures,
});
