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

import type { ChildProcess } from 'node:child_process';
import { createLogger } from '../../utils/logger';

const { logFromError } = createLogger({ feature: 'edition' });

/**
 * Relay for the half of the Enterprise Edition entitlement only one process
 * can learn: the remote grant XTM One returns at registration.
 *
 * Under the `split` profile the worker never registers, so without a relay it
 * would report Community Edition for an instance the HTTP process knows is
 * entitled. The alternative - a row in `platform_metadata` - would outlive the
 * decision it caches: the grant lasts days at most and must not survive a
 * restart, and a durable table is a record, not a cache. It travels as an
 * expiry rather than a boolean, so a process that never hears from the granter
 * again still fails closed on its own clock.
 */
/**
 * Which grant an entitlement message carries: `remote`, what XTM One proved at
 * registration, or `local`, the Filigran license installed on this platform.
 * A message without one is `remote`, the only kind that existed before.
 */
type EntitlementSlot = 'local' | 'remote';

export interface RemoteEntitlement {
  expiresAt: number,
  /** When the license behind the grant says it expires; `null` when no license proves it. */
  licenseExpiresAt: number | null,
  /** Unchecked here: the receiver narrows it to a license type. */
  licenseType: string | null,
  slot?: EntitlementSlot,
}

interface EntitlementGrantedMessage extends RemoteEntitlement {
  type: 'entitlement-granted',
}

interface EntitlementMessage extends RemoteEntitlement {
  type: 'entitlement',
}

const isRemoteEntitlement = (message: object): boolean =>
  'expiresAt' in message && typeof message.expiresAt === 'number' && Number.isFinite(message.expiresAt)
  && 'licenseExpiresAt' in message
  && (message.licenseExpiresAt === null || (typeof message.licenseExpiresAt === 'number' && Number.isFinite(message.licenseExpiresAt)))
  && 'licenseType' in message && (message.licenseType === null || typeof message.licenseType === 'string')
  && (!('slot' in message) || message.slot === undefined || message.slot === 'local' || message.slot === 'remote');

const slotOf = (message: object): EntitlementSlot => ('slot' in message && message.slot === 'local' ? 'local' : 'remote');

const isEntitlementGrantedMessage = (message: unknown): message is EntitlementGrantedMessage =>
  message !== null && typeof message === 'object'
  && 'type' in message && message.type === 'entitlement-granted' && isRemoteEntitlement(message);

const isEntitlementMessage = (message: unknown): message is EntitlementMessage =>
  message !== null && typeof message === 'object'
  && 'type' in message && message.type === 'entitlement' && isRemoteEntitlement(message);

/** Child to parent, after the registering process heard the remote answer. */
// A remote grant travels without a slot, as it always has; only a local one is tagged.
const slotField = (slot: EntitlementSlot | undefined): { slot?: 'local' } => (slot === 'local' ? { slot } : {});

export const publishRemoteEntitlement = ({ expiresAt, licenseExpiresAt, licenseType, slot }: RemoteEntitlement): void => {
  try {
    process.send?.({ type: 'entitlement-granted', expiresAt, licenseExpiresAt, licenseType, ...slotField(slot) });
  } catch (error) {
    logFromError(error, 'Error publishing the remote entitlement to the parent process');
  }
};

/** Parent to child, forwarding what one child published to its siblings. */
export const sendRemoteEntitlement = (child: ChildProcess, { expiresAt, licenseExpiresAt, licenseType, slot }: RemoteEntitlement): void => {
  if (!child.connected) {
    return;
  }
  try {
    child.send({ type: 'entitlement', expiresAt, licenseExpiresAt, licenseType, ...slotField(slot) });
  } catch (error) {
    logFromError(error, 'Error forwarding the remote entitlement to a child process');
  }
};

// Both run on an emitter, where a throw would become an uncaught exception.
export const onRemoteEntitlementGranted = (granted: (entitlement: RemoteEntitlement) => void) => (message: unknown) => {
  if (isEntitlementGrantedMessage(message)) {
    try {
      granted({ expiresAt: message.expiresAt, licenseExpiresAt: message.licenseExpiresAt, licenseType: message.licenseType, slot: slotOf(message) });
    } catch (error) {
      logFromError(error, 'Error relaying a published entitlement');
    }
  }
};

export const onRemoteEntitlement = (received: (entitlement: RemoteEntitlement) => void) => (message: unknown) => {
  if (isEntitlementMessage(message)) {
    try {
      received({ expiresAt: message.expiresAt, licenseExpiresAt: message.licenseExpiresAt, licenseType: message.licenseType, slot: slotOf(message) });
    } catch (error) {
      logFromError(error, 'Error applying a relayed entitlement');
    }
  }
};
