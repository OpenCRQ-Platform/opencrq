import type { AssetCriticality } from '@app/module';
import { ASSET_CRITICALITY_SEVERITY } from '@app/module';

/**
 * An identity's criticality, read from its technical privilege alone.
 *
 * Business role — a CEO, a CFO, a head of trading — is deliberately absent, and so are the job
 * title and department this connector ingests beside these fields: where a business criticality
 * would come from is an open question, and guessing it from a free-text title would put the whole
 * estate on a guess.
 *
 * Every rule yields a band directly. There is no score and no confidence factor to fold: both
 * engines read the band, the estate groups on the band, and a number in between would exist only
 * to be rounded back to one.
 */

/**
 * Directory roles whose holder can grant themselves anything else in the tenant: they administer
 * identity, authentication or the applications that carry it. Compromising one is compromising the
 * directory, which is why they sit a band above every other administrator.
 */
const TIER_0_ROLES: ReadonlySet<string> = new Set([
  'global administrator',
  'privileged role administrator',
  'privileged authentication administrator',
  'application administrator',
  'cloud application administrator',
  'authentication administrator',
  'user administrator',
  'hybrid identity administrator',
  'intune administrator',
  'password administrator',
  'helpdesk administrator',
  'directory synchronization accounts',
  'partner tier1 support',
  'partner tier2 support',
  'domain name administrator',
  'external identity provider administrator',
  'permissions management administrator',
]);

/** Roles that administer or read broadly without being able to re-grant identity itself. */
const TIER_1_ROLES: ReadonlySet<string> = new Set([
  'global reader',
  'security operator',
  'security reader',
]);

/**
 * The privileged groups a logon token can carry, as the `TokenHas<Group>Sid` flags Defender added
 * to `DeviceLogonEvents` in 2026-08. A flag is present in `AdditionalFields` only when true, so an
 * absent one is an absence and never a false.
 *
 * Matched on the group part alone, lower-cased and stripped of everything but letters: a vendor
 * spelling the plural or the full group name would otherwise silently match nothing, which is a
 * miss no rating would show. `countTokenFlagMatches` is what makes that silence visible at run time.
 */
const TOKEN_GROUP_BANDS: ReadonlyMap<string, AssetCriticality> = new Map([
  ['domainadmin', 'very_high'],
  ['domainadmins', 'very_high'],
  ['enterpriseadmin', 'very_high'],
  ['enterpriseadmins', 'very_high'],
  ['schemaadmin', 'very_high'],
  ['schemaadmins', 'very_high'],
  ['grouppolicycreator', 'high'],
  ['grouppolicycreatorowner', 'high'],
  ['grouppolicycreatorowners', 'high'],
  ['certificatepublisher', 'medium'],
  ['certificatepublishers', 'medium'],
  ['certpublisher', 'medium'],
  ['certpublishers', 'medium'],
]);

const TOKEN_FLAG_PATTERN = /^TokenHas(.+)Sid$/;

/**
 * Defender's own scale, which runs from 0 (most critical) down to 4. Level 4 is a reading and not a
 * silence — the vendor looked and placed the account at the bottom of its scale — so it yields
 * `low`. An account the vendor never rated carries no level at all and stays unknown.
 */
const VENDOR_LEVEL_BANDS: ReadonlyMap<number, AssetCriticality> = new Map([
  [0, 'very_high'],
  [1, 'high'],
  [2, 'medium'],
  [3, 'low'],
  [4, 'low'],
]);

/**
 * Well-known SIDs naming a service or a local authority rather than an account: `S-1-5-17`
 * (IUSR), `S-1-5-18` (SYSTEM), `S-1-5-19` (LOCAL SERVICE), `S-1-5-20` (NETWORK SERVICE), and the
 * virtual-account families `S-1-5-80-*` (services), `S-1-5-82-*` (IIS application pools),
 * `S-1-5-83-*` (Hyper-V virtual machines), `S-1-5-90-*` (window manager) and `S-1-5-96-*` (font
 * driver host).
 *
 * The machine-backed families are the ones logon events actually surface: a host running virtual
 * machines logs one `NT VIRTUAL MACHINE\<guid>` account per running guest, so on a real estate they
 * outnumber the people several times over while naming nothing anyone administers.
 */
export const isWellKnownSid = (sid: string): boolean => {
  const upper = sid.toUpperCase();
  return ['S-1-5-17', 'S-1-5-18', 'S-1-5-19', 'S-1-5-20'].includes(upper)
    || /^S-1-5-(80|82|83|90|96)-/.test(upper);
};

/**
 * A computer account, whose name ends in `$`. Ingesting one would be worse than noise: a domain
 * controller's machine account holds Certificate Publisher and Domain Controllers group SIDs, so it
 * would read as one of the most privileged identities in the tenant while naming no account at all.
 */
export const isMachineAccountName = (accountName: string | null | undefined): boolean =>
  (accountName ?? '').trim().endsWith('$');

const isPresent = (value: string | null | undefined): boolean => value !== null && value !== undefined && value.trim() !== '';

/**
 * A disabled account that names nobody: no display name, UPN, account name or SID. Nothing in it can
 * be looked at, matched or acted on. An account whose state is unknown is never one.
 */
export const isDisabledWithoutIdentity = (account: {
  displayName?: string | null,
  upn?: string | null,
  accountName?: string | null,
  cloudSid?: string | null,
  onPremSid?: string | null,
  isEnabled?: boolean | null,
}): boolean => account.isEnabled === false
  && ![account.displayName, account.upn, account.accountName, account.cloudSid, account.onPremSid].some(isPresent);

/** An account this connector must not turn into an identity asset, whatever else it carries. */
export const isIngestableIdentity = (account: {
  displayName?: string | null,
  upn?: string | null,
  accountName?: string | null,
  cloudSid?: string | null,
  onPremSid?: string | null,
  isEnabled?: boolean | null,
}): boolean => {
  if (isMachineAccountName(account.accountName) || isDisabledWithoutIdentity(account)) {
    return false;
  }
  return ![account.cloudSid, account.onPremSid]
    .some((sid) => sid !== null && sid !== undefined && sid !== '' && isWellKnownSid(sid));
};

const mostSevere = (bands: ReadonlyArray<AssetCriticality>): AssetCriticality =>
  bands.reduce<AssetCriticality>((best, band) => (ASSET_CRITICALITY_SEVERITY[band] > ASSET_CRITICALITY_SEVERITY[best] ? band : best), 'unknown');

/** The band a directory or PIM role name yields, or `unknown` when the role names no privilege we rate. */
export const bandOfRoleName = (roleName: string): AssetCriticality => {
  const normalized = roleName.trim().toLowerCase();
  if (TIER_0_ROLES.has(normalized)) {
    return 'very_high';
  }
  if (TIER_1_ROLES.has(normalized) || normalized.endsWith('administrator')) {
    return 'high';
  }
  return 'unknown';
};

/** The band a `TokenHas<Group>Sid` flag yields. A name that is not one of those flags rates nothing. */
export const bandOfTokenFlag = (flagName: string): AssetCriticality => {
  const group = TOKEN_FLAG_PATTERN.exec(flagName.trim())?.[1];
  if (group === undefined) {
    return 'unknown';
  }
  return TOKEN_GROUP_BANDS.get(group.toLowerCase().replace(/[^a-z]/g, '')) ?? 'unknown';
};

/**
 * How many of the flags seen across a sync this catalogue actually rated, against how many token
 * flags were seen at all. A run that sees flags and rates none of them means the vendor spells them
 * differently — a silence the sync logs rather than carries.
 */
export const countTokenFlagMatches = (flagNames: ReadonlyArray<string>): { seen: number, rated: number } => {
  const tokenFlags = flagNames.filter((name) => TOKEN_FLAG_PATTERN.test(name.trim()));
  return {
    seen: tokenFlags.length,
    rated: tokenFlags.filter((name) => bandOfTokenFlag(name) !== 'unknown').length,
  };
};

/** The band Defender's own `IdentityInfo.CriticalityLevel` yields; anything outside 0–4 rates nothing. */
export const bandOfVendorLevel = (level: number | null): AssetCriticality =>
  (level === null ? 'unknown' : VENDOR_LEVEL_BANDS.get(level) ?? 'unknown');

export interface IdentityPrivilege {
  vendorCriticalityLevel: number | null,
  assignedRoles: ReadonlyArray<string>,
  privilegedPimRoles: ReadonlyArray<string>,
  /** The `TokenHas<Group>Sid` flags the account's logon tokens carried inside the session window. */
  tokenFlags: ReadonlyArray<string>,
}

/**
 * The band the connector states for an identity: the most severe its rules yield, `unknown` when
 * none names it. PIM eligibility counts exactly as the role does — eligibility is a standing
 * capability, and an account that can elevate on demand carries the privilege whether or not it
 * happened to hold it when the directory was read.
 */
export const identityCriticality = (privilege: IdentityPrivilege): AssetCriticality => mostSevere([
  bandOfVendorLevel(privilege.vendorCriticalityLevel),
  ...[...privilege.assignedRoles, ...privilege.privilegedPimRoles].map(bandOfRoleName),
  ...privilege.tokenFlags.map(bandOfTokenFlag),
]);
