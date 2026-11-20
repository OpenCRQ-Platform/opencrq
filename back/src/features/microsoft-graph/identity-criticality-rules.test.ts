import { describe, expect, it } from 'vitest';
import {
  bandOfRoleName,
  bandOfTokenFlag,
  bandOfVendorLevel,
  countTokenFlagMatches,
  identityCriticality,
  isIngestableIdentity,
  isMachineAccountName,
  isWellKnownSid,
} from './identity-criticality-rules';

const privilege = (overrides: Partial<Parameters<typeof identityCriticality>[0]> = {}) => ({
  vendorCriticalityLevel: null,
  assignedRoles: [],
  privilegedPimRoles: [],
  tokenFlags: [],
  ...overrides,
});

describe('bandOfVendorLevel', () => {
  it('maps Defender\'s scale onto the bands, its bottom level included', () => {
    expect(bandOfVendorLevel(0)).toBe('very_high');
    expect(bandOfVendorLevel(1)).toBe('high');
    expect(bandOfVendorLevel(2)).toBe('medium');
    expect(bandOfVendorLevel(3)).toBe('low');
    expect(bandOfVendorLevel(4)).toBe('low');
  });
  it('reads the absence of a level as unknown, which is not the same as the bottom of the scale', () => {
    expect(bandOfVendorLevel(null)).toBe('unknown');
    expect(bandOfVendorLevel(-1)).toBe('unknown');
  });
});

describe('bandOfRoleName', () => {
  it('puts the roles that administer identity itself a band above the rest', () => {
    expect(bandOfRoleName('Global Administrator')).toBe('very_high');
    expect(bandOfRoleName('Privileged Role Administrator')).toBe('very_high');
    expect(bandOfRoleName('Directory Synchronization Accounts')).toBe('very_high');
  });
  it('is insensitive to the casing a source reports', () => {
    expect(bandOfRoleName('  global administrator ')).toBe('very_high');
  });
  it('rates any other administrator role high', () => {
    expect(bandOfRoleName('Exchange Administrator')).toBe('high');
    expect(bandOfRoleName('Teams Administrator')).toBe('high');
  });
  it('rates the broad readers high without them being administrators', () => {
    expect(bandOfRoleName('Global Reader')).toBe('high');
    expect(bandOfRoleName('Security Operator')).toBe('high');
    expect(bandOfRoleName('Security Reader')).toBe('high');
  });
  it('rates nothing for a role naming no privilege', () => {
    expect(bandOfRoleName('Message Center Reader')).toBe('unknown');
    expect(bandOfRoleName('Guest Inviter')).toBe('unknown');
  });
});

describe('bandOfTokenFlag', () => {
  it('rates the three directory-owning groups very high', () => {
    expect(bandOfTokenFlag('TokenHasDomainAdminSid')).toBe('very_high');
    expect(bandOfTokenFlag('TokenHasEnterpriseAdminSid')).toBe('very_high');
    expect(bandOfTokenFlag('TokenHasSchemaAdminSid')).toBe('very_high');
  });
  it('rates the group policy creators high and the certificate publishers medium', () => {
    expect(bandOfTokenFlag('TokenHasGroupPolicyCreatorSid')).toBe('high');
    expect(bandOfTokenFlag('TokenHasCertificatePublisherSid')).toBe('medium');
  });
  it('accepts the plural and the fuller group names, since only one flag is confirmed against a tenant', () => {
    expect(bandOfTokenFlag('TokenHasDomainAdminsSid')).toBe('very_high');
    expect(bandOfTokenFlag('TokenHasGroupPolicyCreatorOwnersSid')).toBe('high');
    expect(bandOfTokenFlag('TokenHasCertPublishersSid')).toBe('medium');
  });
  it('rates nothing for a flag naming no privileged group, or for anything not a token flag', () => {
    expect(bandOfTokenFlag('TokenHasDomainUsersSid')).toBe('unknown');
    expect(bandOfTokenFlag('IsLocalAdmin')).toBe('unknown');
    expect(bandOfTokenFlag('')).toBe('unknown');
  });
});

describe('countTokenFlagMatches', () => {
  it('counts the token flags seen against those this catalogue rates', () => {
    expect(countTokenFlagMatches(['TokenHasDomainAdminSid', 'TokenHasDomainUsersSid', 'IsLocalAdmin']))
      .toEqual({ seen: 2, rated: 1 });
  });
  it('reports a run that saw flags and rated none, which is what a vendor rename looks like', () => {
    expect(countTokenFlagMatches(['TokenHasSomethingElseSid'])).toEqual({ seen: 1, rated: 0 });
  });
});

describe('identityCriticality', () => {
  it('reads unknown when no rule names the account, rather than guessing', () => {
    expect(identityCriticality(privilege())).toBe('unknown');
  });
  it('takes the most severe band its rules yield', () => {
    expect(identityCriticality(privilege({
      vendorCriticalityLevel: 2,
      assignedRoles: ['Global Administrator'],
    }))).toBe('very_high');
  });
  it('rates an account very high on a token flag alone, with no directory record naming it', () => {
    expect(identityCriticality(privilege({
      tokenFlags: ['TokenHasDomainAdminSid'],
    }))).toBe('very_high');
  });
  it('counts PIM eligibility exactly as the role, since eligibility is a standing capability', () => {
    expect(identityCriticality(privilege({ privilegedPimRoles: ['Global Administrator'] }))).toBe('very_high');
  });
  it('does not let an unrated role pull a rated one down', () => {
    expect(identityCriticality(privilege({
      assignedRoles: ['Guest Inviter', 'Security Reader'],
    }))).toBe('high');
  });
});

describe('isWellKnownSid', () => {
  it('recognises the local authorities', () => {
    expect(isWellKnownSid('S-1-5-17')).toBe(true);
    expect(isWellKnownSid('S-1-5-18')).toBe(true);
    expect(isWellKnownSid('S-1-5-19')).toBe(true);
    expect(isWellKnownSid('S-1-5-20')).toBe(true);
  });
  it('recognises the virtual account families', () => {
    expect(isWellKnownSid('S-1-5-80-3880718306-3832830129-1677859214-2598158968-1052248003')).toBe(true);
    expect(isWellKnownSid('S-1-5-90-0-1')).toBe(true);
    expect(isWellKnownSid('S-1-5-96-0-1')).toBe(true);
  });
  it('recognises the machine-backed families a logon event floods the estate with', () => {
    // One per running guest on a virtualisation host, named by the guest's GUID.
    expect(isWellKnownSid('S-1-5-83-1-4601186616-2258095835-2519855921-1962195905')).toBe(true);
    expect(isWellKnownSid('S-1-5-82-3006700770-424185619-1745488364-794895919-4004696415')).toBe(true);
  });
  it('leaves a real domain account alone', () => {
    expect(isWellKnownSid('S-1-5-21-1004336348-1177238915-682003330-1001')).toBe(false);
    // The prefix is a family, not a substring: an ordinary RID starting with 80 is not one.
    expect(isWellKnownSid('S-1-5-21-1-2-3-80')).toBe(false);
  });
});

describe('isMachineAccountName', () => {
  it('recognises a computer account', () => {
    expect(isMachineAccountName('DC01$')).toBe(true);
    expect(isMachineAccountName(' WKS-042$ ')).toBe(true);
  });
  it('leaves a person alone', () => {
    expect(isMachineAccountName('jdoe')).toBe(false);
    expect(isMachineAccountName(null)).toBe(false);
    expect(isMachineAccountName(undefined)).toBe(false);
  });
});

describe('isIngestableIdentity', () => {
  it('accepts an ordinary account', () => {
    expect(isIngestableIdentity({ accountName: 'jdoe', onPremSid: 'S-1-5-21-1-2-3-1001' })).toBe(true);
  });
  it('refuses a machine account, which would otherwise read as the most privileged thing in the tenant', () => {
    expect(isIngestableIdentity({ accountName: 'DC01$', onPremSid: 'S-1-5-21-1-2-3-1000' })).toBe(false);
  });
  it('refuses a local authority', () => {
    expect(isIngestableIdentity({ accountName: 'SYSTEM', onPremSid: 'S-1-5-18' })).toBe(false);
    expect(isIngestableIdentity({ accountName: 'svc', cloudSid: 'S-1-5-80-1-2-3-4-5' })).toBe(false);
  });
  it('reads an empty SID as absent rather than as a value to test', () => {
    expect(isIngestableIdentity({ accountName: 'jdoe', cloudSid: '', onPremSid: 'S-1-5-21-1-2-3-1001' })).toBe(true);
  });

  describe('a disabled account', () => {
    it('is refused when it carries nothing that identifies it', () => {
      expect(isIngestableIdentity({ isEnabled: false })).toBe(false);
      expect(isIngestableIdentity({ isEnabled: false, displayName: '  ', upn: '', accountName: null, cloudSid: undefined, onPremSid: '' })).toBe(false);
    });
    it.each([
      ['a display name', { displayName: 'Nadia Fournier' }],
      ['a UPN', { upn: 'n.fournier@acme.example' }],
      ['an account name', { accountName: 'nfournier' }],
      ['a cloud SID', { cloudSid: 'S-1-12-1-4001-4002-4003-4004' }],
      ['an on-premises SID', { onPremSid: 'S-1-5-21-1-2-3-1001' }],
    ])('is kept when it carries %s', (_label, identifying) => {
      expect(isIngestableIdentity({ isEnabled: false, ...identifying })).toBe(true);
    });
    it('is still refused when what it carries is a local authority', () => {
      expect(isIngestableIdentity({ isEnabled: false, displayName: 'System', onPremSid: 'S-1-5-18' })).toBe(false);
    });
  });
  it('keeps an enabled account that carries nothing', () => {
    expect(isIngestableIdentity({ isEnabled: true })).toBe(true);
  });
  it('keeps an account whose state is unknown and that carries nothing', () => {
    expect(isIngestableIdentity({ isEnabled: null })).toBe(true);
    expect(isIngestableIdentity({})).toBe(true);
  });
});
