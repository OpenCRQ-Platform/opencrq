import type { AssetRelationSource } from '@app/module';
import { normalizeMacs } from '@app/module';
import { z } from 'zod';

const FETCH_TIMEOUT_MS = 60_000;

export const ENTRA_DEVICES_URL = 'https://graph.microsoft.com/v1.0/devices?$select=deviceId&$expand=registeredOwners($select=id)&$top=999';
export const INTUNE_DEVICES_URL = 'https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$select=azureADDeviceId,userId,wiFiMacAddress,ethernetMacAddress&$top=1000';

const entraDeviceSchema = z.object({
  deviceId: z.string().nullable().optional(),
  registeredOwners: z.array(z.object({ id: z.string() })).optional(),
});
export type EntraDevice = z.infer<typeof entraDeviceSchema>;

const intuneDeviceSchema = z.object({
  azureADDeviceId: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  wiFiMacAddress: z.string().nullable().optional(),
  ethernetMacAddress: z.string().nullable().optional(),
});
export type IntuneDevice = z.infer<typeof intuneDeviceSchema>;

const pageSchema = <T extends z.ZodType>(item: T) => z.object({
  value: z.array(item),
  '@odata.nextLink': z.string().optional(),
});

/**
 * `refused` is a tenant that did not grant the permission, `unavailable` a source that did not answer
 * in full for any other reason. Either way the sync carries on without it. `error` is what a request
 * threw, kept for the logs: `reason` alone reads the same for a DNS failure, a TLS error and a bug.
 */
export type SourceRead<T> =
  | { status: 'answered', items: Array<T> }
  | { status: 'refused', httpStatus: number }
  | { status: 'unavailable', reason: string, error?: unknown };

const unavailableReason = (err: unknown): string => {
  const name = err instanceof Error ? err.name : '';
  if (name === 'TimeoutError') {
    return 'timed out';
  }
  return name === 'SyntaxError' ? 'unexpected response' : 'unreachable';
};

/**
 * Reads a paged Graph collection whole, and throws only when the job itself is aborted: a primary
 * user is no reason to fail a sync that already stored every device. A tenant without Intune
 * answers 400 (`Request not applicable to target tenant`), and a throttled, failing or silent
 * service is unavailable for this pass. Only a read that got every page is answered, so a partial
 * one never retires a relation.
 */
const readCollection = async <T>(
  token: string,
  firstUrl: string,
  item: z.ZodType<T>,
  signal: AbortSignal,
): Promise<SourceRead<T>> => {
  const items: Array<T> = [];
  let url: string | undefined = firstUrl;
  try {
    while (url !== undefined) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
      });
      if (res.status === 401 || res.status === 403) {
        return { status: 'refused', httpStatus: res.status };
      }
      if (!res.ok) {
        return { status: 'unavailable', reason: String(res.status) };
      }
      const parsed = pageSchema(item).safeParse(await res.json());
      if (!parsed.success) {
        return { status: 'unavailable', reason: 'unexpected response' };
      }
      items.push(...parsed.data.value);
      url = parsed.data['@odata.nextLink'];
    }
  } catch (err) {
    if (signal.aborted) {
      throw err;
    }
    return { status: 'unavailable', reason: unavailableReason(err), error: err };
  }
  return { status: 'answered', items };
};

export const readEntraDevices = (token: string, signal: AbortSignal) =>
  readCollection(token, ENTRA_DEVICES_URL, entraDeviceSchema, signal);

export const readIntuneDevices = (token: string, signal: AbortSignal) =>
  readCollection(token, INTUNE_DEVICES_URL, intuneDeviceSchema, signal);

export interface PrimaryUser {
  identityAssetId: string,
  deviceAssetId: string,
  source: AssetRelationSource,
}

/** A primary user the connector already holds, as stored: from the identity to the device. */
export interface HeldPrimaryUser {
  id: string,
  fromAssetId: string,
  toAssetId: string,
  source: AssetRelationSource,
}

const lower = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase();

const addTo = <K, V>(map: Map<K, Set<V>>, key: K, value: V) => {
  const bucket = map.get(key) ?? new Set<V>();
  bucket.add(value);
  map.set(key, bucket);
};

/**
 * The primary user of each of the connector's devices, from whichever sources answered.
 *
 * Intune comes first where it names a user, and a device it names is not read from Entra; when
 * Intune did not answer, that holds for the devices it named at its last answer, which the connector
 * still holds. Both join on the Entra device id; Intune alone falls back to a MAC address, for a
 * device that has none, and only on a MAC naming exactly one Intune device and exactly one device
 * asset: a USB-C adapter or a dock carries one MAC across every machine it is plugged into. Nothing
 * is matched by name, and an owner that is not one of the connector's identities makes no relation.
 */
export const resolvePrimaryUsers = (input: {
  devices: ReadonlyArray<{ supportingAssetId: string, directoryDeviceId: string | null, macAddresses: ReadonlyArray<string>, lastSeenAt: Date | null }>,
  identities: ReadonlyArray<{ supportingAssetId: string, sourceAssetId: string }>,
  entraDevices: ReadonlyArray<EntraDevice> | null,
  intuneDevices: ReadonlyArray<IntuneDevice> | null,
  held: ReadonlyArray<HeldPrimaryUser>,
}): Array<PrimaryUser> => {
  const identityByObjectId = new Map(input.identities.map((identity) => [lower(identity.sourceAssetId), identity.supportingAssetId]));
  // A reinstalled machine can leave Defender holding two records under one Entra device id, the old
  // one no longer reporting: the primary user belongs to the record still in use, the latest seen.
  const latestByDirectoryId = new Map<string, { supportingAssetId: string, lastSeenAt: number }>();
  const devicesByMac = new Map<string, Set<string>>();
  for (const device of input.devices) {
    if (device.directoryDeviceId) {
      const key = lower(device.directoryDeviceId);
      const lastSeenAt = device.lastSeenAt?.getTime() ?? Number.NEGATIVE_INFINITY;
      const current = latestByDirectoryId.get(key);
      if (current === undefined || lastSeenAt > current.lastSeenAt) {
        latestByDirectoryId.set(key, { supportingAssetId: device.supportingAssetId, lastSeenAt });
      }
    } else {
      for (const mac of device.macAddresses) {
        addTo(devicesByMac, mac, device.supportingAssetId);
      }
    }
  }
  const deviceByDirectoryId = (directoryDeviceId: string | null | undefined): Set<string> | undefined => {
    const latest = latestByDirectoryId.get(lower(directoryDeviceId));
    return latest === undefined ? undefined : new Set([latest.supportingAssetId]);
  };

  // Counted over every device a MAC is carried by, not only those without an Entra device id: a
  // dock's MAC on a joined laptop makes it just as ambiguous for the unjoined one beside it.
  const devicesPerMac = new Map<string, number>();
  for (const device of input.devices) {
    for (const mac of device.macAddresses) {
      devicesPerMac.set(mac, (devicesPerMac.get(mac) ?? 0) + 1);
    }
  }

  const intuneMacs = (device: IntuneDevice) => normalizeMacs([device.wiFiMacAddress ?? '', device.ethernetMacAddress ?? '']);
  const intuneDevicesPerMac = new Map<string, number>();
  for (const device of input.intuneDevices ?? []) {
    for (const mac of intuneMacs(device)) {
      intuneDevicesPerMac.set(mac, (intuneDevicesPerMac.get(mac) ?? 0) + 1);
    }
  }

  const relations = new Map<string, PrimaryUser>();
  const add = (identityAssetId: string, deviceAssetId: string, source: AssetRelationSource) => {
    relations.set(`${identityAssetId}:${deviceAssetId}`, { identityAssetId, deviceAssetId, source });
  };

  const namedByIntune = new Set(input.intuneDevices === null
    ? input.held.filter((relation) => relation.source === 'intune_primary_user').map((relation) => relation.toAssetId)
    : []);
  for (const device of input.intuneDevices ?? []) {
    const identityAssetId = identityByObjectId.get(lower(device.userId));
    if (identityAssetId === undefined) {
      continue;
    }
    const byMac = new Set(intuneMacs(device).flatMap((mac) => {
      const candidates = devicesByMac.get(mac);
      return intuneDevicesPerMac.get(mac) === 1 && devicesPerMac.get(mac) === 1 && candidates?.size === 1 ? [...candidates] : [];
    }));
    // Its Wi-Fi and Ethernet MACs naming two different assets is the same ambiguity as one MAC naming two.
    const targets = deviceByDirectoryId(device.azureADDeviceId) ?? (byMac.size === 1 ? byMac : new Set<string>());
    for (const deviceAssetId of targets) {
      namedByIntune.add(deviceAssetId);
      add(identityAssetId, deviceAssetId, 'intune_primary_user');
    }
  }

  for (const device of input.entraDevices ?? []) {
    const targets = deviceByDirectoryId(device.deviceId) ?? new Set<string>();
    for (const owner of device.registeredOwners ?? []) {
      const identityAssetId = identityByObjectId.get(lower(owner.id));
      if (identityAssetId === undefined) {
        continue;
      }
      for (const deviceAssetId of targets) {
        if (!namedByIntune.has(deviceAssetId)) {
          add(identityAssetId, deviceAssetId, 'entra_registered_owner');
        }
      }
    }
  }

  return [...relations.values()];
};

/**
 * The primary users the connector holds that this pass retires. A source that answered no longer
 * naming one retires it, and so does a device the pass names, of whatever it did not name again,
 * since one source answers for a device whole. What a source that did not answer named on any
 * other device is kept, its last observation no longer moving.
 */
export const retiredPrimaryUsers = (input: {
  held: ReadonlyArray<HeldPrimaryUser>,
  observed: ReadonlyArray<PrimaryUser>,
  answeredSources: ReadonlyArray<AssetRelationSource>,
}): Array<string> => {
  const observedPairs = new Set(input.observed.map((user) => `${user.identityAssetId}:${user.deviceAssetId}`));
  const namedDevices = new Set(input.observed.map((user) => user.deviceAssetId));
  return input.held
    .filter((relation) => !observedPairs.has(`${relation.fromAssetId}:${relation.toAssetId}`)
      && (input.answeredSources.includes(relation.source) || namedDevices.has(relation.toAssetId)))
    .map((relation) => relation.id);
};

const describeRead = (name: string, read: SourceRead<unknown>): string => {
  switch (read.status) {
    case 'answered':
      return `${name} answered`;
    case 'refused':
      return `${name} refused (${read.httpStatus})`;
    case 'unavailable':
      return `${name} unavailable (${read.reason})`;
  }
};

/** The sync's closing line for this pass: how many primary users, and how each source answered. */
export const describePrimaryUserPass = (written: number, entra: SourceRead<unknown>, intune: SourceRead<unknown>): string =>
  `${written} ${written === 1 ? 'primary user' : 'primary users'}; ${describeRead('Microsoft Entra ID', entra)}, ${describeRead('Intune', intune)}`;
