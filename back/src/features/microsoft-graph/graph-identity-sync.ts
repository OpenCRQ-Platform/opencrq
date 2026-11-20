import type { ConnectorAssetInput } from '@app/module';
import { z } from 'zod';
import { identityCriticality, isDisabledWithoutIdentity, isIngestableIdentity } from './identity-criticality-rules';
import { mapIdentitySubcategory } from './graph-mapping-utils';
import { optionalText } from './graph-types';

/** Identities per transaction, on the same reasoning as the device chunk: one write, one doorbell. */
export const STORE_IDENTITY_CHUNK = 200;

/**
 * A dynamic column comes back as a real array from the hunting API, but the same field inside a
 * serialized bag arrives as a JSON string. Both are accepted and anything else reads as absent, so
 * a shape change fails the row rather than storing a silent empty list.
 */
const stringList = z.unknown().optional().transform((value): Array<string> => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
});

// Advanced Hunting serializes a null number as an empty object, exactly as it does on the device
// side; `CriticalityLevel` is the one number an identity row carries.
const nullableNumber = z.union([z.number(), z.null(), z.strictObject({})]).optional()
  .transform((v) => (typeof v === 'number' ? v : null));
const nullableFlag = z.union([z.boolean(), z.number(), z.null(), z.strictObject({})]).optional()
  .transform((v) => {
    if (typeof v === 'boolean') {
      return v;
    }
    return typeof v === 'number' ? v !== 0 : null;
  });
const optionalDate = optionalText.transform((v) => {
  const date = v === null ? null : new Date(v);
  return date !== null && !Number.isNaN(date.getTime()) ? date : null;
});

export const identityRowSchema = z.looseObject({
  IdentityKey: z.string().min(1),
  Timestamp: optionalDate,
  AccountObjectId: optionalText,
  AccountUpn: optionalText,
  AccountName: optionalText,
  AccountDomain: optionalText,
  AccountDisplayName: optionalText,
  OnPremSid: optionalText,
  CloudSid: optionalText,
  Type: optionalText,
  Department: optionalText,
  JobTitle: optionalText,
  IsAccountEnabled: nullableFlag,
  AssignedRoles: stringList,
  PrivilegedEntraPimRoles: stringList,
  CriticalityLevel: nullableNumber,
});
export type IdentityRow = z.infer<typeof identityRowSchema>;

export const logonAccountRowSchema = z.looseObject({
  AccountSid: z.string().min(1),
  Timestamp: optionalDate,
  AccountDomain: optionalText,
  AccountName: optionalText,
});
export type LogonAccountRow = z.infer<typeof logonAccountRowSchema>;

export const tokenFlagRowSchema = z.looseObject({
  AccountSid: z.string().min(1),
  TokenFlags: stringList,
});
export type TokenFlagRow = z.infer<typeof tokenFlagRowSchema>;

/** One account as the two logon queries together describe it. */
export interface LogonIdentityRow {
  AccountSid: string,
  AccountDomain: string | null,
  AccountName: string | null,
  /** The account's most recent logon event. */
  Timestamp: Date | null,
  TokenFlags: Array<string>,
}

/**
 * The two logon reads, keyed by SID. They are separate queries and joined here rather than in KQL:
 * the advanced hunting parser refuses a `let` block containing `mv-expand … to typeof(string)`,
 * while each of these runs on its own, and an account with no token flag must still come back.
 */
export const mergeLogonRows = (
  accounts: ReadonlyArray<LogonAccountRow>,
  tokenFlags: ReadonlyArray<TokenFlagRow>,
): Map<string, LogonIdentityRow> => {
  const flagsBySid = new Map(tokenFlags.map((row) => [row.AccountSid.toUpperCase(), row.TokenFlags]));
  return new Map(accounts.map((row) => [row.AccountSid.toUpperCase(), {
    AccountSid: row.AccountSid,
    AccountDomain: row.AccountDomain,
    AccountName: row.AccountName,
    Timestamp: row.Timestamp,
    TokenFlags: flagsBySid.get(row.AccountSid.toUpperCase()) ?? [],
  }]));
};

/**
 * One row per account, newest snapshot wins. An account the directory knows carries an object id;
 * one synced from on-premises Active Directory alone may carry only a SID, so the page key falls
 * back to it rather than collapsing every such account onto one empty key.
 */
const ALL_IDENTITIES = [
  'IdentityInfo',
  '| where Timestamp > ago(30d)',
  '| extend IdentityKey = iff(isnotempty(AccountObjectId), tostring(AccountObjectId), strcat("sid:", coalesce(tostring(OnPremSid), tostring(CloudSid), "")))',
  '| where IdentityKey != "" and IdentityKey != "sid:"',
  '| summarize arg_max(Timestamp, *) by IdentityKey',
].join('\n');

export const buildIdentityQuery = (cursor: string | null, pageSize: number): string => [
  `let allIdentities = (${ALL_IDENTITIES});`,
  'allIdentities',
  ...(cursor ? [`| where strcmp(IdentityKey, "${cursor}") > 0`] : []),
  '| order by IdentityKey asc',
  `| take ${pageSize}`,
  '| project IdentityKey, Timestamp, AccountObjectId, AccountUpn, AccountName, AccountDomain, AccountDisplayName,',
  '          OnPremSid, CloudSid, Type, Department, JobTitle, IsAccountEnabled,',
  '          AssignedRoles, PrivilegedEntraPimRoles, CriticalityLevel',
].join('\n');

/**
 * The key the next page starts after: that of the last record read, rejected or not, since a
 * cursor on the last valid record reads a rejected tail again and counts it twice.
 */
export const nextIdentityCursor = (rawRows: ReadonlyArray<Record<string, unknown>>): string | null =>
  rawRows.map((row) => identityRowSchema.shape.IdentityKey.safeParse(row.IdentityKey)).findLast((key) => key.success)?.data ?? null;

export const IDENTITY_COUNT_QUERY = [
  ALL_IDENTITIES,
  '| count',
].join('\n');

/**
 * Every account the logon events name, aggregated server-side to one row per SID: the raw events
 * are a five-figure table and only the newest name each account was seen under is read.
 *
 * An account with no privileged token flag is still returned — it is how an identity the directory
 * never reported becomes an asset at all.
 */
export const LOGON_ACCOUNTS_QUERY = [
  'DeviceLogonEvents',
  '| where Timestamp > ago(30d)',
  '| where isnotempty(AccountSid)',
  '| summarize arg_max(Timestamp, AccountDomain, AccountName) by AccountSid',
  '| project AccountSid, Timestamp, AccountDomain, AccountName',
].join('\n');

/**
 * The privileged-group flags an account's logon tokens carried, as the `TokenHas<Group>Sid` keys of
 * `AdditionalFields`. A key is present only when the flag is true, so an absent one is an absence.
 */
export const LOGON_TOKEN_FLAGS_QUERY = [
  'DeviceLogonEvents',
  '| where Timestamp > ago(30d) and isnotempty(AccountSid) and isnotempty(AdditionalFields)',
  '| extend Bag = todynamic(AdditionalFields)',
  '| mv-expand FlagName = bag_keys(Bag) to typeof(string)',
  '| where FlagName startswith "TokenHas"',
  '| summarize TokenFlags = make_set(FlagName, 50) by AccountSid',
].join('\n');

const identityName = (row: { AccountDisplayName: string | null, AccountUpn: string | null, AccountName: string | null, AccountDomain: string | null }): string | null => {
  if (row.AccountDisplayName !== null) {
    return row.AccountDisplayName;
  }
  if (row.AccountUpn !== null) {
    return row.AccountUpn;
  }
  if (row.AccountName !== null) {
    return row.AccountDomain !== null ? `${row.AccountDomain}\\${row.AccountName}` : row.AccountName;
  }
  return null;
};

const directoryAccount = (row: IdentityRow) => ({
  displayName: row.AccountDisplayName,
  upn: row.AccountUpn,
  accountName: row.AccountName,
  cloudSid: row.CloudSid,
  onPremSid: row.OnPremSid,
  isEnabled: row.IsAccountEnabled,
});

/**
 * The directory records, joined to whatever their logon tokens carried. Both SIDs are looked up in
 * the logon set: an account reaches the logon events under whichever SID its token presented.
 */
export const toDirectoryIdentityInputs = (
  rows: ReadonlyArray<IdentityRow>,
  logonsBySid: ReadonlyMap<string, LogonIdentityRow>,
  connectorId: string,
): Array<ConnectorAssetInput> => rows
  .filter((row) => isIngestableIdentity(directoryAccount(row)))
  .map((row) => {
    const tokenFlags = [row.CloudSid, row.OnPremSid]
      .flatMap((sid) => (sid === null ? [] : logonsBySid.get(sid.toUpperCase())?.TokenFlags ?? []));
    return {
      sourceAssetId: row.IdentityKey,
      categoryId: 'identity' as const,
      subcategoryId: row.Type === null ? null : mapIdentitySubcategory(row.Type),
      connectorId,
      source: 'microsoft_graph',
      name: identityName(row),
      // The newest directory snapshot, so an account the directory stopped returning ages visibly
      // instead of keeping its band looking live. No first-seen: the 30-day window would only ever
      // report its own start.
      lastSeenAt: row.Timestamp,
      criticality: identityCriticality({
        vendorCriticalityLevel: row.CriticalityLevel,
        assignedRoles: row.AssignedRoles,
        privilegedPimRoles: row.PrivilegedEntraPimRoles,
        tokenFlags,
      }),
      properties: {
        family: 'identity' as const,
        directoryObjectId: row.AccountObjectId,
        cloudSid: row.CloudSid,
        onPremSid: row.OnPremSid,
        userPrincipalName: row.AccountUpn,
        accountDomain: row.AccountDomain,
        accountName: row.AccountName,
        directoryType: row.Type,
        department: row.Department,
        jobTitle: row.JobTitle,
        isEnabled: row.IsAccountEnabled,
        assignedRoles: row.AssignedRoles,
        privilegedPimRoles: row.PrivilegedEntraPimRoles,
      },
    };
  });

/**
 * The SID-keyed observations a directory record now supersedes: every SID the directory pass just
 * reported, spelled the way the logon pass would have keyed it. Deleting a key no earlier sync ever
 * wrote is a no-op, so this needs no memory of what previous runs created.
 *
 * A record with no object id is itself keyed `sid:<SID>`, and that key is never superseded: it is
 * the observation this very sync just wrote.
 */
export const supersededLogonKeys = (rows: ReadonlyArray<IdentityRow>): Array<string> =>
  [...new Set(rows.flatMap((row) => [row.CloudSid, row.OnPremSid]
    .flatMap((sid) => (sid === null ? [] : [`sid:${sid}`]))
    .filter((key) => key !== row.IdentityKey)))];

/**
 * The keys of the directory records the sync no longer imports because they are disabled and carry
 * nothing that identifies them. Records another rule refuses are not named: a machine account or a
 * well-known SID was never an asset to retire.
 */
export const droppedIdentityKeys = (rows: ReadonlyArray<IdentityRow>): Array<string> =>
  rows.filter((row) => isDisabledWithoutIdentity(directoryAccount(row))).map((row) => row.IdentityKey);

/** An Entra account's SID, which a logon on an Entra-joined device presents instead of a domain SID. */
const isCloudSid = (sid: string): boolean => sid.toUpperCase().startsWith('S-1-12-1-');

/**
 * The accounts the logon events name and the directory does not. Keyed by their SID, which is the
 * only identifier they have.
 *
 * When the directory later returns such an account, the matcher folds the two observations onto one
 * asset and this pass stops emitting the SID-keyed one. Nothing in the estate retires a source row
 * on its own, so `supersededLogonKeys` names them and the sync deletes them explicitly — otherwise
 * one account would sit under two keys of one connector for good.
 */
export const toLogonOnlyIdentityInputs = (
  logonRows: ReadonlyArray<LogonIdentityRow>,
  knownSids: ReadonlySet<string>,
  connectorId: string,
): Array<ConnectorAssetInput> => logonRows
  .filter((row) => !knownSids.has(row.AccountSid.toUpperCase()))
  .filter((row) => isIngestableIdentity({ accountName: row.AccountName, onPremSid: row.AccountSid }))
  .map((row) => ({
    sourceAssetId: `sid:${row.AccountSid}`,
    categoryId: 'identity' as const,
    // Nothing states what kind of account this is: the directory never returned it, and inferring
    // one from the name would put a guess where the taxonomy expects a reading.
    subcategoryId: null,
    connectorId,
    source: 'microsoft_graph',
    name: row.AccountDomain !== null && row.AccountName !== null
      ? `${row.AccountDomain}\\${row.AccountName}`
      : row.AccountName,
    lastSeenAt: row.Timestamp,
    criticality: identityCriticality({
      vendorCriticalityLevel: null,
      assignedRoles: [],
      privilegedPimRoles: [],
      tokenFlags: row.TokenFlags,
    }),
    properties: {
      family: 'identity' as const,
      directoryObjectId: null,
      // The column decides the provider the account reads as, and lets the identity matcher fold
      // it onto its directory record, which carries the same SID in the same column.
      ...(isCloudSid(row.AccountSid) ? { cloudSid: row.AccountSid } : { onPremSid: row.AccountSid }),
      accountDomain: row.AccountDomain,
      accountName: row.AccountName,
    },
  }));
