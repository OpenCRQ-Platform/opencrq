import type { AiTargetConnectorProperties, IdentityManualProperties, MachineConnectorProperties } from './types';

/**
 * Identity normalisation, copied from OpenAEV's own endpoint-matching rules rather than
 * reinvented: lower-case hostnames, separator-stripped lower-case MACs, and denylists for
 * values that look like an identifier but are not one (loopback/link-local addresses, the
 * broadcast/all-zero/multicast MAC placeholders, and virtual-NIC OUIs that a cloned VM shares
 * with its template).
 */

const MAC_DENYLIST = new Set([
  'ffffffffffff', // broadcast
  '000000000000', // all-zero placeholder
  '0180c2000000', // IEEE 802.1D multicast
]);

// Clone-prone virtual NIC vendor prefixes (OUI, first 3 bytes): a MAC under one of these can be
// shared by every VM cloned from the same template, so it never carries a match on its own.
const VIRTUAL_MAC_OUI_PREFIXES = [
  '005056', // VMware
  '080027', // VirtualBox
  '00155d', // Hyper-V
  '0242', // Docker (locally administered, 2-byte prefix)
];

const IP_DENYLIST_EXACT = new Set(['::1']);
const IP_DENYLIST_PREFIXES = ['169.254.']; // link-local

const isIpv4Loopback = (ip: string): boolean => {
  const match = /^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.exec(ip);
  return match !== null && Number(match[1]) === 127;
};

// fe80::/10: the first group's top 10 bits are fixed, which — since a shorter group never pads to
// four digits, it drops leading zeros instead — only a full 4-hex-digit group can satisfy.
const isIpv6LinkLocal = (ip: string): boolean => {
  const firstGroup = ip.split(':', 1)[0] ?? '';
  return /^fe[89ab][0-9a-f]$/i.test(firstGroup);
};

export const normalizeHostname = (hostname: string | null | undefined): string | null => {
  const trimmed = hostname?.trim().toLowerCase();
  return trimmed ? trimmed : null;
};

/**
 * An address a device announces in place of a name — some agents fall back to it when no DNS name
 * is configured. It reads like a qualified hostname (dotted, non-empty labels) while carrying none
 * of the identity one does: two machines on private ranges reused across sites announce the same
 * one.
 */
export const isIpLiteral = (value: string): boolean =>
  /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes(':');

/**
 * A source API that serializes an absent attribute as `""` rather than `null` (Microsoft Graph's
 * Advanced Hunting does, for several identity fields) must not have that empty string treated as a
 * real identifier by the matcher: every device sharing the absence would otherwise collide on it.
 */
export const normalizeIdentifier = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * A Windows security identifier, upper-cased so two sources spelling one SID differently still
 * match. Anything not shaped like one is dropped rather than stored: a SID is the matcher's join
 * key for an account known only from logon events, and a free-text value landing in that column
 * would fuse every identity carrying the same non-SID string.
 */
export const normalizeSid = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim().toUpperCase();
  return trimmed && /^S-1-\d+(-\d+)*$/.test(trimmed) ? trimmed : null;
};

/**
 * A user principal name, lower-cased: it is an email-shaped identifier and case carries no meaning
 * in one, so two sources disagreeing on capitalisation must not read as two accounts.
 */
export const normalizeUpn = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && trimmed.includes('@') ? trimmed : null;
};

/**
 * Directory role names, kept in the vendor's own casing because they are shown as reported, but
 * de-duplicated case-insensitively: a role held both directly and through PIM eligibility arrives
 * twice, spelled two ways.
 */
export const normalizeRoleNames = (values: ReadonlyArray<string> | null | undefined): Array<string> => {
  const seen = new Set<string>();
  return (values ?? []).flatMap((value) => {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [trimmed];
  });
};

// Each connector names an OS in its own vocabulary — Defender's `OSPlatform` carries a release
// (`Windows11`, `WindowsServer2019`), OpenAEV's `PLATFORM_TYPE` a bare family in its own casing
// (`Windows`, `MacOS`) — so the two overlap on `Linux` alone. A prefix per family folds both into
// one word; a release is deliberately dropped, since the matcher asks whether two observations
// describe the same machine, not whether it was patched between two syncs.
const PLATFORM_FAMILY_PREFIXES: ReadonlyArray<[string, string]> = [
  ['windows', 'windows'],
  ['macos', 'macos'],
  ['mac os', 'macos'],
  ['osx', 'macos'],
  ['linux', 'linux'],
  ['android', 'android'],
  ['ios', 'ios'],
  ['ipados', 'ios'],
  ['container', 'container'],
  ['service', 'service'],
];

/**
 * The OS family, for the tier-3 corroboration alone. Anything unrecognised — OpenAEV's `Generic`,
 * `Internal` and `Unknown` included — is null rather than kept verbatim: a spelling this list does
 * not know carries no evidence that two observations are the same machine, and tier 3 declines to
 * fire on a null rather than reading an unfamiliar word as a disagreement.
 */
export const normalizePlatform = (platform: string | null | undefined): string | null => {
  const trimmed = platform?.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  return PLATFORM_FAMILY_PREFIXES.find(([prefix]) => trimmed.startsWith(prefix))?.[1] ?? null;
};

/** Strips separators and lower-cases; returns null for anything that is not an identifier. */
export const normalizeMac = (mac: string | null | undefined): string | null => {
  if (!mac) {
    return null;
  }
  const stripped = mac.toLowerCase().replaceAll(/[^0-9a-f]/g, '');
  if (stripped.length !== 12) {
    return null;
  }
  if (MAC_DENYLIST.has(stripped)) {
    return null;
  }
  if (VIRTUAL_MAC_OUI_PREFIXES.some((prefix) => stripped.startsWith(prefix))) {
    return null;
  }
  return stripped;
};

/** Digit runs compare as numbers, so `10.0.0.2` sorts before `10.0.0.10` on the asset card. */
const ADDRESS_ORDER = new Intl.Collator('en', { numeric: true });

/**
 * A set of addresses in one canonical order. A source that builds the list from an unordered set
 * (Defender's KQL `make_set`) reports it in a different order on each run, which would otherwise
 * read as a change and rewrite the row. The code-unit comparison settles what the collator holds
 * equal (`01` and `1`), so the order never depends on the order reported.
 */
const toCanonicalSet = (values: ReadonlyArray<string>): Array<string> =>
  [...new Set(values)].toSorted((a, b) => ADDRESS_ORDER.compare(a, b) || (a < b ? -1 : (a > b ? 1 : 0)));

export const normalizeMacs = (macs: ReadonlyArray<string> | null | undefined): Array<string> => {
  if (!macs) {
    return [];
  }
  return toCanonicalSet(macs.map(normalizeMac).filter((mac): mac is string => mac !== null));
};

const isDenylistedIp = (ip: string): boolean => {
  const trimmed = ip.trim().toLowerCase();
  if (IP_DENYLIST_EXACT.has(trimmed)) {
    return true;
  }
  if (IP_DENYLIST_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return true;
  }
  return isIpv4Loopback(trimmed) || isIpv6LinkLocal(trimmed);
};

/** A single reported address — OpenAEV's `asset_seen_ip` — under the same rules as `normalizeIps`. */
export const normalizeIp = (ip: string | null | undefined): string | null => {
  const trimmed = ip?.trim().toLowerCase();
  return trimmed && !isDenylistedIp(trimmed) ? trimmed : null;
};

export const normalizeIps = (ips: ReadonlyArray<string> | null | undefined): Array<string> => {
  if (!ips) {
    return [];
  }
  // Lowercased like the other normalizers: two connectors serializing the same IPv6 in different
  // cases must overlap, since tier 3 joins on that overlap alone.
  return toCanonicalSet(ips.map(normalizeIp).filter((ip): ip is string => ip !== null));
};

const DEFAULT_PORT_BY_SCHEME: Record<string, string> = { 'http:': '80', 'https:': '443' };

/**
 * The AI target matcher's one identifier: lower-cased scheme and host, a default port dropped
 * (`:443` on `https` says nothing an equal host does not), a trailing slash dropped, the path kept
 * as reported. The query string is kept, its parameters sorted so two spellings of one order agree:
 * a deployment or API version there names a different target, and the AI target matcher is
 * deliberately the strictest one we have. Stored alongside the raw URL at ingestion rather than
 * computed at read time, so the matcher's index can be built directly from it. Malformed input
 * degrades to `null` rather than throwing — an unparseable endpoint carries no identity either way.
 */
export const normalizeEndpointUrl = (url: string | null | undefined): string | null => {
  const trimmed = url?.trim();
  if (!trimmed) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  const scheme = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port && parsed.port !== DEFAULT_PORT_BY_SCHEME[scheme] ? `:${parsed.port}` : '';
  const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
  parsed.searchParams.sort();
  const query = parsed.searchParams.size > 0 ? `?${parsed.searchParams.toString()}` : '';
  return `${scheme}//${host}${port}${path}${query}`;
};

/**
 * A `machine` block through the same normalisation a connector's own input gets
 * (`bulkUpsertAssets`), so a value a person types by hand and one a connector reports reach the
 * matcher on equal footing — a MAC typed `AA:BB:CC:DD:EE:FF` must join the `aabbccddeeff` a
 * connector stored, or adoption never fires.
 */
export const normalizeMachineProperties = (properties: MachineConnectorProperties) => ({
  hostname: normalizeHostname(properties.hostname),
  ipAddresses: normalizeIps(properties.ipAddresses),
  macAddresses: normalizeMacs(properties.macAddresses),
  seenIp: normalizeIp(properties.seenIp),
  hardwareUuid: normalizeIdentifier(properties.hardwareUuid),
  directoryDeviceId: normalizeIdentifier(properties.directoryDeviceId),
  cloudVmId: normalizeIdentifier(properties.cloudVmId),
  cloudResourceId: normalizeIdentifier(properties.cloudResourceId),
  cloudProvider: properties.cloudProvider ?? null,
  cloudNativeType: normalizeIdentifier(properties.cloudNativeType),
  cloudRegion: normalizeIdentifier(properties.cloudRegion),
  platform: normalizePlatform(properties.platform),
  arch: properties.arch ?? null,
  vendor: normalizeIdentifier(properties.vendor),
  model: normalizeIdentifier(properties.model),
  operatingSystem: normalizeIdentifier(properties.operatingSystem),
  osVersion: normalizeIdentifier(properties.osVersion),
  isEol: properties.isEol ?? null,
  agentExternalReference: normalizeIdentifier(properties.agentExternalReference),
  agentExecutorType: normalizeIdentifier(properties.agentExecutorType),
});

/** An `ai_target` block through the same normalisation as `normalizeMachineProperties`, above. */
export const normalizeAiTargetProperties = (properties: AiTargetConnectorProperties) => ({
  provider: properties.provider ?? null,
  endpointUrl: properties.endpointUrl ?? null,
  normalizedEndpointUrl: normalizeEndpointUrl(properties.endpointUrl),
  model: normalizeIdentifier(properties.model),
  modality: properties.modality ?? null,
  systemPrompt: properties.systemPrompt ?? null,
});

/**
 * An `identity` block through the same normalisation as `normalizeMachineProperties`, above. The
 * directory is taken as stated when a person states it, and otherwise derived: a connector sees
 * which SID it read, and nothing else in its payload says which directory the account lives in.
 */
export const normalizeIdentityProperties = (properties: IdentityManualProperties) => {
  const cloudSid = normalizeSid(properties.cloudSid);
  const onPremSid = normalizeSid(properties.onPremSid);
  return {
    directoryObjectId: normalizeIdentifier(properties.directoryObjectId),
    cloudSid,
    onPremSid,
    userPrincipalName: normalizeUpn(properties.userPrincipalName),
    accountDomain: normalizeHostname(properties.accountDomain),
    accountName: normalizeHostname(properties.accountName),
    directoryType: normalizeIdentifier(properties.directoryType),
    identityProvider: properties.identityProvider ?? (cloudSid !== null ? 'entra' as const : (onPremSid !== null ? 'active_directory' as const : null)),
    department: normalizeIdentifier(properties.department),
    jobTitle: normalizeIdentifier(properties.jobTitle),
    isEnabled: properties.isEnabled ?? null,
    assignedRoles: normalizeRoleNames(properties.assignedRoles),
    privilegedPimRoles: normalizeRoleNames(properties.privilegedPimRoles),
  };
};
