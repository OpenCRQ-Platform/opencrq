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
import { z } from 'zod';
import { newError } from '@app/utils';
import type { XtmOneSettings } from './xtm-one-config';
import type { ServedProcedureManifest } from '../app-router/procedure-manifest';
import type { RegistrationEntitlement, RegistrationHealth, RegistrationResult, XtmOneEntitlementRefusal } from './xtm-one-registration';
import { createLogger } from '../../utils/logger';
import { ensureInstance, grantRemoteEntitlement, isEnterpriseEdition } from '../edition';
import { recordSignInClientId } from '../xtm-sign-in/xtm-sign-in-client';
import { callbackUrl, isAcceptedCallback } from '../xtm-sign-in/xtm-sign-in';
import { classifyRegistrationStatus, recordRegistrationFailure, recordRegistrationSuccess } from './xtm-one-reachability';
import { buildRegistrationBody, procedureManifestPayload, readRegistrationEntitlement, registrationResultSchema } from './xtm-one-registration';

const { logTrace, logWarn, logFromError } = createLogger({ feature: 'xtm-one' });

const REGISTER_PATH = '/api/v1/platform/register';
const REGISTER_TIMEOUT_MS = 30_000;
const REFUSAL_DETAIL_MAX_LENGTH = 500;

/** The refusal last logged, so the heartbeats repeating it stay quiet until its cause changes. */
let reportedRefusal: string | null = null;
let lastRefusalCode: XtmOneEntitlementRefusal | null = null;

/**
 * Why the last registration answer entitled nothing despite claiming Enterprise
 * Edition or carrying a license; `null` once an answer entitles or claims
 * nothing. Written by the heartbeat, so it is only meaningful in the process
 * that runs it, which is the one serving `xtmOne.getSettings`.
 */
export const getEntitlementRefusal = (): XtmOneEntitlementRefusal | null => lastRefusalCode;

const reportRefusal = (refusal: RegistrationEntitlement['refusal']): void => {
  const message = refusal?.message ?? null;
  if (message !== null && message !== reportedRefusal) {
    logWarn(message);
  }
  reportedRefusal = message;
  lastRefusalCode = refusal?.code ?? null;
};

/**
 * XTM One's reason for refusing a registration: its `detail`, only when it is a
 * string. A validation error's `detail` is a list that can quote the body sent,
 * license included, so it is never kept.
 */
const refusalDetail = async (response: Response): Promise<string | undefined> => {
  try {
    const answer = z.object({ detail: z.string() }).safeParse(await response.json());
    return answer.success ? answer.data.detail.slice(0, REFUSAL_DETAIL_MAX_LENGTH) : undefined;
  } catch {
    return undefined;
  }
};

interface RegistrationIdentity {
  instanceId: string,
  createdAt: number,
}

/** One registration POST and the reading of its answer. */
const postRegistration = async (
  settings: XtmOneSettings,
  body: Record<string, unknown>,
  { instanceId, createdAt }: RegistrationIdentity,
): Promise<RegistrationResult | null> => {

  let text: string;
  try {
    const response = await fetch(`${settings.url}${REGISTER_PATH}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REGISTER_TIMEOUT_MS),
    });
    if (!response.ok) {
      recordRegistrationFailure(classifyRegistrationStatus(response.status));
      const detail = await refusalDetail(response);
      logFromError(
        newError(`XTM One registration failed with HTTP ${response.status}`),
        'XTM One registration failed',
        { status: response.status, ...(detail !== undefined && { detail }) },
      );
      return null;
    }
    text = await response.text();
  } catch (error) {
    // The timeout also covers the body read, so a rejected fetch and a body cut
    // short are the same transport failure: nothing readable was delivered.
    recordRegistrationFailure('unreachable');
    // The remote entitlement is deliberately left untouched: it lapses on its
    // own expiry, so a transient outage does not revoke EE mid-heartbeat
    // while a lasting one still fails closed.
    logFromError(error, 'XTM One registration request failed');
    return null;
  }

  const unreadable = (reason: string, data?: { issues: string }): null => {
    recordRegistrationFailure('unreadable');
    // The held entitlement stays as it is, like after an outage, and the body is
    // never logged: it may carry the license.
    logFromError(newError(reason), 'XTM One registration answer cannot be read', data);
    return null;
  };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // V8 quotes an excerpt of the rejected input in its message.
    return unreadable('XTM One registration answer is not valid JSON');
  }
  const parsed = registrationResultSchema.safeParse(json);
  if (!parsed.success) {
    // A `ZodError` serializes its issues twice, in `message` and as `issues`.
    return unreadable('XTM One registration answer does not match the expected shape', {
      issues: z.prettifyError(parsed.error),
    });
  }

  const result = parsed.data;
  recordRegistrationSuccess();
  const entitlement = readRegistrationEntitlement(result, { platformId: instanceId, instanceCreatedAt: createdAt, now: Date.now() });
  grantRemoteEntitlement(entitlement.entitledUntil, entitlement.licenseExpiresAt, entitlement.licenseType);
  reportRefusal(entitlement.refusal);
  logTrace('Registered with XTM One', {
    xtmOneVersion: result.version ?? 'unknown',
    eeEnabled: isEnterpriseEdition(),
  });
  return result;
};

let refusedCallbackLogged = false;

/**
 * The sign-in callback to register, or none when XTM One would refuse it (not
 * HTTPS, not loopback): that refusal would take the whole registration down,
 * entitlement included, so signing in with XTM One is left off instead.
 */
const acceptedCallback = (settings: XtmOneSettings): string | undefined => {
  const callback = callbackUrl(settings);
  if (isAcceptedCallback(callback)) {
    return callback;
  }
  if (!refusedCallbackLogged) {
    refusedCallbackLogged = true;
    logWarn('Sign-in with XTM One stays off: XTM_ONE__PLATFORM_URL must be HTTPS (or loopback)', { callback });
  }
  return undefined;
};

/**
 * Register (and heartbeat) this OpenCRQ instance with XTM One.
 *
 * `POST {xtm_one.url}/api/v1/platform/register` with the shared
 * registration token - the same contract as OpenCTI's
 * `xtmOneRegistrationManager` and OpenAEV's `XtmOneService.autoRegister`.
 * The endpoint is an upsert; calling it every 5 minutes doubles as the
 * liveness heartbeat on the XTM One side.
 *
 * Every heartbeat carries the fingerprint of the procedure manifest. When the answer says XTM One
 * does not hold it, the same body follows at once with the manifest added; that one's
 * answer never asks for a third, the next heartbeat asks again if it still has to.
 *
 * The sign-in client id is read from the answer returned: the follow-up's when it
 * was read, the first one's when it failed. Without a readable
 * answer the previous id stays, like the entitlement after an outage.
 */
export const registerWithXtmOne = async (
  settings: XtmOneSettings,
  db: DrizzleDB,
  procedureManifest: () => ServedProcedureManifest | null = () => null,
  readHealth: () => Promise<RegistrationHealth | null> = () => Promise.resolve(null),
): Promise<RegistrationResult | null> => {
  let identity: RegistrationIdentity;
  let body: Record<string, unknown>;
  let manifest: ServedProcedureManifest | null;
  // The health snapshot is a report, never a condition: a failed read registers without it, so
  // the heartbeat and the entitlement it carries never depend on the jobs table.
  let health: RegistrationHealth | null = null;
  try {
    health = await readHealth();
  } catch (error) {
    logFromError(error, 'XTM One health snapshot could not be read; registering without it');
  }
  try {
    identity = await ensureInstance(db);
    // The approval prompt lives in Ask Ariane, which is EE-gated: without the
    // entitlement every chat route answers 403, so there would be nobody to
    // ask. This reads the previous heartbeat's answer, the very thing this
    // response refreshes, so an entitled instance declares `false` on its
    // first registration after a restart and `true` from the next. XTM One
    // keeps gating our tools throughout - `false` falls through to its
    // platform approval policy, whose default is to gate - and the panel
    // advertises its own per-message `supports_tool_approval` regardless, so
    // a live prompt still works inside that window.
    const supportsApprovalPrompts = isEnterpriseEdition();
    manifest = procedureManifest();
    body = buildRegistrationBody(settings, identity.instanceId, {
      supportsApprovalPrompts,
      procedureManifest: manifest,
      signInRedirectUri: acceptedCallback(settings),
      health,
    });
  } catch (error) {
    // Not recorded as unreachable: the request never left, the database failed.
    logFromError(error, 'XTM One registration request failed');
    return null;
  }

  const result = await postRegistration(settings, body, identity);
  const kept = result?.procedure_manifest_wanted === true && manifest !== null
    ? await postRegistration(settings, { ...body, procedure_manifest: procedureManifestPayload(manifest) }, identity) ?? result
    : result;
  if (kept !== null) {
    recordSignInClientId(kept.sign_in_client_id ?? null);
  }
  return kept;
};
