import { describe, expect, it } from 'vitest';
import type { IdentityRow, LogonIdentityRow } from './graph-identity-sync';
import {
  droppedIdentityKeys,
  identityRowSchema,
  logonAccountRowSchema,
  mergeLogonRows,
  supersededLogonKeys,
  toDirectoryIdentityInputs,
  tokenFlagRowSchema,
  toLogonOnlyIdentityInputs,
} from './graph-identity-sync';

const identityRow = (overrides: Partial<IdentityRow> = {}): IdentityRow => ({
  IdentityKey: 'obj-1',
  Timestamp: new Date('2026-09-20T08:00:00Z'),
  AccountObjectId: 'obj-1',
  AccountUpn: 'j.doe@example.com',
  AccountName: 'jdoe',
  AccountDomain: 'corp',
  AccountDisplayName: 'Jane Doe',
  OnPremSid: 'S-1-5-21-1-2-3-1001',
  CloudSid: null,
  Type: 'User',
  Department: 'Finance',
  JobTitle: 'Analyst',
  IsAccountEnabled: true,
  AssignedRoles: [],
  PrivilegedEntraPimRoles: [],
  CriticalityLevel: null,
  ...overrides,
});

const logonRow = (overrides: Partial<LogonIdentityRow> = {}): LogonIdentityRow => ({
  AccountSid: 'S-1-5-21-1-2-3-1001',
  AccountDomain: 'corp',
  AccountName: 'jdoe',
  Timestamp: new Date('2026-09-21T09:30:00Z'),
  TokenFlags: [],
  ...overrides,
});

describe('identityRowSchema', () => {
  it('reads a null number serialized as an empty object, which is what Advanced Hunting sends', () => {
    const parsed = identityRowSchema.parse({ IdentityKey: 'k', CriticalityLevel: {} });
    expect(parsed.CriticalityLevel).toBeNull();
  });
  it('reads a role list whether it arrives as an array or as a JSON string', () => {
    expect(identityRowSchema.parse({ IdentityKey: 'k', AssignedRoles: ['Global Administrator'] }).AssignedRoles)
      .toEqual(['Global Administrator']);
    expect(identityRowSchema.parse({ IdentityKey: 'k', AssignedRoles: '["Global Administrator"]' }).AssignedRoles)
      .toEqual(['Global Administrator']);
  });
  it('reads the empty string an absent attribute is serialized as, as absent', () => {
    expect(identityRowSchema.parse({ IdentityKey: 'k', AccountUpn: '' }).AccountUpn).toBeNull();
  });
  it('reads a timestamp that does not parse as absent, never as an invalid date', () => {
    expect(identityRowSchema.parse({ IdentityKey: 'k', Timestamp: 'not a date' }).Timestamp).toBeNull();
    expect(identityRowSchema.parse({ IdentityKey: 'k', Timestamp: '2026-09-20T08:00:00Z' }).Timestamp)
      .toEqual(new Date('2026-09-20T08:00:00Z'));
  });

  it('refuses a row with no key at all rather than storing an unkeyed identity', () => {
    expect(identityRowSchema.safeParse({ IdentityKey: '' }).success).toBe(false);
  });
});

describe('toDirectoryIdentityInputs', () => {
  it('states the identity family, the subcategory and the properties Defender carries', () => {
    const [input] = toDirectoryIdentityInputs([identityRow()], new Map(), 'connector-1');

    expect(input).toMatchObject({
      sourceAssetId: 'obj-1',
      categoryId: 'identity',
      subcategoryId: 'user_account',
      name: 'Jane Doe',
      criticality: 'unknown',
      properties: {
        family: 'identity',
        directoryObjectId: 'obj-1',
        onPremSid: 'S-1-5-21-1-2-3-1001',
        userPrincipalName: 'j.doe@example.com',
        department: 'Finance',
        jobTitle: 'Analyst',
        isEnabled: true,
      },
    });
  });

  it('dates the account from its newest directory snapshot, and states no first sighting', () => {
    const [input] = toDirectoryIdentityInputs([identityRow()], new Map(), 'connector-1');
    expect(input?.lastSeenAt).toEqual(new Date('2026-09-20T08:00:00Z'));
    expect(input?.firstSeenAt).toBeUndefined();
  });

  it('maps a service account to its own subcategory, which is five sixths of a real tenant', () => {
    const [input] = toDirectoryIdentityInputs([identityRow({ Type: 'ServiceAccount' })], new Map(), 'connector-1');
    expect(input?.subcategoryId).toBe('service_account');
  });

  it('leaves the subcategory unset for a type the taxonomy does not know, keeping the raw value', () => {
    const [input] = toDirectoryIdentityInputs([identityRow({ Type: 'SomethingNew' })], new Map(), 'connector-1');
    expect(input?.subcategoryId).toBeNull();
    expect(input?.properties).toMatchObject({ directoryType: 'SomethingNew' });
  });

  it('rates an account from its directory role', () => {
    const [input] = toDirectoryIdentityInputs(
      [identityRow({ AssignedRoles: ['Global Administrator'] })], new Map(), 'connector-1',
    );
    expect(input?.criticality).toBe('very_high');
  });

  it('rates an account from the token flags its logon events carried, joined on either SID', () => {
    const logons = new Map([['S-1-5-21-1-2-3-1001', logonRow({ TokenFlags: ['TokenHasDomainAdminSid'] })]]);
    const [input] = toDirectoryIdentityInputs([identityRow()], logons, 'connector-1');
    expect(input?.criticality).toBe('very_high');
  });

  it('never ingests a machine account, whatever privilege its token carries', () => {
    const rows = [identityRow({ AccountName: 'DC01$', IdentityKey: 'obj-dc' })];
    expect(toDirectoryIdentityInputs(rows, new Map(), 'connector-1')).toEqual([]);
  });

  it('never ingests a well-known SID', () => {
    const rows = [identityRow({ OnPremSid: 'S-1-5-18', AccountName: 'SYSTEM' })];
    expect(toDirectoryIdentityInputs(rows, new Map(), 'connector-1')).toEqual([]);
  });

  it('falls back through display name, UPN, then the qualified account name', () => {
    const named = (overrides: Partial<IdentityRow>) =>
      toDirectoryIdentityInputs([identityRow(overrides)], new Map(), 'connector-1')[0]?.name;

    expect(named({ AccountDisplayName: null })).toBe('j.doe@example.com');
    expect(named({ AccountDisplayName: null, AccountUpn: null })).toBe('corp\\jdoe');
    expect(named({ AccountDisplayName: null, AccountUpn: null, AccountDomain: null })).toBe('jdoe');
  });
});

describe('a disabled account carrying nothing that identifies it', () => {
  const bare = (overrides: Partial<IdentityRow> = {}) => identityRow({
    IdentityKey: 'obj-bare',
    AccountObjectId: 'obj-bare',
    AccountUpn: null,
    AccountName: null,
    AccountDomain: null,
    AccountDisplayName: null,
    OnPremSid: null,
    CloudSid: null,
    IsAccountEnabled: false,
    ...overrides,
  });

  it('is not emitted as an asset', () => {
    expect(toDirectoryIdentityInputs([bare(), identityRow()], new Map(), 'connector-1').map((input) => input.sourceAssetId))
      .toEqual(['obj-1']);
  });

  it('is named by droppedIdentityKeys, and nothing else is', () => {
    const rows = [
      bare(),
      bare({ IdentityKey: 'obj-bare-2', AccountObjectId: 'obj-bare-2' }),
      identityRow(),
      bare({ IdentityKey: 'obj-known', AccountObjectId: 'obj-known', AccountDisplayName: 'Nadia Fournier' }),
      bare({ IdentityKey: 'obj-enabled', AccountObjectId: 'obj-enabled', IsAccountEnabled: true }),
      bare({ IdentityKey: 'obj-unknown-state', AccountObjectId: 'obj-unknown-state', IsAccountEnabled: null }),
    ];
    expect(droppedIdentityKeys(rows)).toEqual(['obj-bare', 'obj-bare-2']);
  });

  it('is not named when another rule is what refuses the row', () => {
    expect(droppedIdentityKeys([identityRow({ AccountName: 'DC01$', IsAccountEnabled: false })])).toEqual([]);
    expect(droppedIdentityKeys([identityRow({ OnPremSid: 'S-1-5-18', IsAccountEnabled: false })])).toEqual([]);
  });

  it('is kept as an asset, disabled, when it is named', () => {
    const [input] = toDirectoryIdentityInputs([bare({ AccountDisplayName: 'Nadia Fournier' })], new Map(), 'connector-1');
    expect(input?.name).toBe('Nadia Fournier');
    expect(input?.properties).toMatchObject({ isEnabled: false });
  });
});

describe('toLogonOnlyIdentityInputs', () => {
  it('creates an asset for an account the directory never returned, keyed by its SID', () => {
    const [input] = toLogonOnlyIdentityInputs([logonRow()], new Set(), 'connector-1');

    expect(input).toMatchObject({
      sourceAssetId: 'sid:S-1-5-21-1-2-3-1001',
      categoryId: 'identity',
      subcategoryId: null,
      name: 'corp\\jdoe',
      properties: { family: 'identity', onPremSid: 'S-1-5-21-1-2-3-1001', directoryObjectId: null },
    });
  });

  it('files an Entra SID, which a logon on an Entra-joined device presents, as the cloud SID', () => {
    const [input] = toLogonOnlyIdentityInputs([logonRow({ AccountSid: 'S-1-12-1-9-9-9-9' })], new Set(), 'connector-1');
    expect(input?.properties).toMatchObject({ cloudSid: 'S-1-12-1-9-9-9-9' });
    expect(input?.properties).not.toHaveProperty('onPremSid');
  });

  it('dates the account from its most recent logon', () => {
    const [input] = toLogonOnlyIdentityInputs([logonRow()], new Set(), 'connector-1');
    expect(input?.lastSeenAt).toEqual(new Date('2026-09-21T09:30:00Z'));
  });

  it('skips an account the directory pass already covered, so one account never gets two keys', () => {
    const known = new Set(['S-1-5-21-1-2-3-1001']);
    expect(toLogonOnlyIdentityInputs([logonRow()], known, 'connector-1')).toEqual([]);
  });

  it('matches the known set case-insensitively, since a SID is spelled either way', () => {
    const known = new Set(['S-1-5-21-1-2-3-1001']);
    expect(toLogonOnlyIdentityInputs([logonRow({ AccountSid: 's-1-5-21-1-2-3-1001' })], known, 'connector-1')).toEqual([]);
  });

  it('rates an account very high from its token alone, with no directory record naming it', () => {
    const [input] = toLogonOnlyIdentityInputs(
      [logonRow({ TokenFlags: ['TokenHasDomainAdminSid'] })], new Set(), 'connector-1',
    );
    expect(input?.criticality).toBe('very_high');
  });

  it('never ingests a machine account or a local authority', () => {
    expect(toLogonOnlyIdentityInputs([logonRow({ AccountName: 'DC01$' })], new Set(), 'connector-1')).toEqual([]);
    expect(toLogonOnlyIdentityInputs([logonRow({ AccountSid: 'S-1-5-18', AccountName: 'SYSTEM' })], new Set(), 'connector-1')).toEqual([]);
  });
});

describe('supersededLogonKeys', () => {
  it('names the SID-keyed observations the directory record now replaces, both SIDs', () => {
    expect(supersededLogonKeys([identityRow({ CloudSid: 'S-1-12-1-9-9-9-9' })]))
      .toEqual(['S-1-12-1-9-9-9-9', 'S-1-5-21-1-2-3-1001'].map((sid) => `sid:${sid}`));
  });
  it('names nothing for a record carrying no SID', () => {
    expect(supersededLogonKeys([identityRow({ OnPremSid: null, CloudSid: null })])).toEqual([]);
  });

  it('never names the key of a record that has no object id, which is the row just written', () => {
    const adOnly = identityRow({ IdentityKey: 'sid:S-1-5-21-1-2-3-1001', AccountObjectId: null });
    expect(supersededLogonKeys([adOnly])).toEqual([]);
    expect(supersededLogonKeys([{ ...adOnly, CloudSid: 'S-1-12-1-9-9-9-9' }])).toEqual(['sid:S-1-12-1-9-9-9-9']);
  });
});

describe('the two logon reads', () => {
  it('reads an absent token flag list as empty rather than failing the row', () => {
    expect(tokenFlagRowSchema.parse({ AccountSid: 'S-1-5-21-1-2-3-1' }).TokenFlags).toEqual([]);
  });

  it('reads the empty string an absent account name is serialized as, as absent', () => {
    expect(logonAccountRowSchema.parse({ AccountSid: 'S-1-5-21-1-2-3-1', AccountName: '' }).AccountName).toBeNull();
  });

  it('keeps an account the flags query never returned, which is most of them', () => {
    const merged = mergeLogonRows([{ AccountSid: 'S-1-5-21-1-2-3-1', Timestamp: null, AccountDomain: 'corp', AccountName: 'jdoe' }], []);
    expect(merged.get('S-1-5-21-1-2-3-1')).toMatchObject({ AccountName: 'jdoe', TokenFlags: [] });
  });

  it('attaches the flags to their account, matching the SID whatever its casing', () => {
    const merged = mergeLogonRows(
      [{ AccountSid: 's-1-5-21-1-2-3-1', Timestamp: null, AccountDomain: null, AccountName: 'admin' }],
      [{ AccountSid: 'S-1-5-21-1-2-3-1', TokenFlags: ['TokenHasDomainAdminSid'] }],
    );
    expect(merged.get('S-1-5-21-1-2-3-1')?.TokenFlags).toEqual(['TokenHasDomainAdminSid']);
  });

  it('drops flags naming an account the accounts query did not return', () => {
    const merged = mergeLogonRows([], [{ AccountSid: 'S-1-5-21-9-9-9-9', TokenFlags: ['TokenHasDomainAdminSid'] }]);
    expect(merged.size).toBe(0);
  });
});
