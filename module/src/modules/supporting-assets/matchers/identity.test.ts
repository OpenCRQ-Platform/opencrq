import { describe, expect, it } from 'vitest';
import type { AssetObservation, IdentityAssetProperties } from '../types';
import { buildIdentityIdentityIndex } from './identity';

let seq = 0;

const identityObservation = (
  sourceAssetId: string,
  properties: Partial<Omit<IdentityAssetProperties, 'family'>> = {},
): AssetObservation => ({
  id: `obs-${seq++}`,
  connectorId: 'connector-microsoft_graph',
  origin: 'connector',
  source: 'microsoft_graph',
  sourceAssetId,
  reportedName: null,
  reportedCategoryId: 'identity',
  reportedSubcategoryId: null,
  reportedDescription: null,
  reportedExposure: 'unknown',
  reportedCriticality: 'unknown',
  externalReference: null,
  reportedUrl: null,
  reportedLinkedPerson: null,
  firstSeenAt: null,
  lastSeenAt: null,
  sourceLastActivityAt: new Date(0),
  properties: {
    family: 'identity',
    directoryObjectId: null,
    cloudSid: null,
    onPremSid: null,
    userPrincipalName: null,
    accountDomain: null,
    accountName: null,
    directoryType: null,
    identityProvider: null,
    department: null,
    jobTitle: null,
    isEnabled: null,
    assignedRoles: [],
    privilegedPimRoles: [],
    ...properties,
  },
});

describe('buildIdentityIdentityIndex', () => {
  it('resolves a directory record onto itself by its Entra object id', () => {
    const index = buildIdentityIdentityIndex();
    index.register('asset-1', identityObservation('obj-1', { directoryObjectId: 'obj-1' }));

    expect(index.resolve(identityObservation('obj-1', { directoryObjectId: 'obj-1' }))).toBe('asset-1');
  });

  it('fuses an account first seen in a logon event onto its later directory record, by SID', () => {
    const index = buildIdentityIdentityIndex();
    // First sync: the account appears only in logon events, keyed by the SID its token carried.
    index.register('asset-1', identityObservation('S-1-5-21-1-2-3-1001', { onPremSid: 'S-1-5-21-1-2-3-1001' }));

    // Second sync: the directory returns it, keyed by the object id and carrying both SIDs.
    const directoryRecord = identityObservation('obj-1', {
      directoryObjectId: 'obj-1',
      cloudSid: 'S-1-12-1-9-9-9-9',
      onPremSid: 'S-1-5-21-1-2-3-1001',
    });

    expect(index.resolve(directoryRecord)).toBe('asset-1');
  });

  it('resolves the logon-keyed observation onto the directory record when that one was seen first', () => {
    const index = buildIdentityIdentityIndex();
    index.register('asset-1', identityObservation('obj-1', {
      directoryObjectId: 'obj-1',
      cloudSid: 'S-1-12-1-9-9-9-9',
      onPremSid: 'S-1-5-21-1-2-3-1001',
    }));

    expect(index.resolve(identityObservation('S-1-5-21-1-2-3-1001', { onPremSid: 'S-1-5-21-1-2-3-1001' }))).toBe('asset-1');
  });

  it('matches a cloud SID against an on-prem SID column, since a SID names one principal either way', () => {
    const index = buildIdentityIdentityIndex();
    index.register('asset-1', identityObservation('a', { onPremSid: 'S-1-5-21-1-2-3-1001' }));

    expect(index.resolve(identityObservation('b', { cloudSid: 'S-1-5-21-1-2-3-1001' }))).toBe('asset-1');
  });

  it('keeps two accounts apart when nothing joins them', () => {
    const index = buildIdentityIdentityIndex();
    index.register('asset-1', identityObservation('obj-1', { directoryObjectId: 'obj-1' }));

    expect(index.resolve(identityObservation('obj-2', { directoryObjectId: 'obj-2' }))).toBeUndefined();
  });

  it('never joins two accounts on a shared UPN', () => {
    const index = buildIdentityIdentityIndex();
    index.register('asset-1', identityObservation('obj-1', { directoryObjectId: 'obj-1', userPrincipalName: 'shared@example.com' }));

    // A leaver's mailbox handed to a joiner carries the same UPN under a new object id.
    expect(index.resolve(identityObservation('obj-2', { directoryObjectId: 'obj-2', userPrincipalName: 'shared@example.com' }))).toBeUndefined();
  });

  it('never matches two observations that merely share an absence', () => {
    const index = buildIdentityIdentityIndex();
    index.register('asset-1', identityObservation('a'));

    expect(index.resolve(identityObservation('b'))).toBeUndefined();
  });

  it('reads an observation of another family as carrying nothing', () => {
    const index = buildIdentityIdentityIndex();
    index.register('asset-1', identityObservation('obj-1', { directoryObjectId: 'obj-1' }));

    const machineObservation: AssetObservation = {
      ...identityObservation('obj-1'),
      properties: {
        family: 'machine',
        hostname: null,
        ipAddresses: [],
        macAddresses: [],
        seenIp: null,
        hardwareUuid: null,
        directoryDeviceId: null,
        cloudVmId: null,
        cloudResourceId: null,
        cloudProvider: null,
        cloudNativeType: null,
        cloudRegion: null,
        platform: null,
        arch: null,
        vendor: null,
        model: null,
        operatingSystem: null,
        osVersion: null,
        isEol: null,
        agentExternalReference: null,
        agentExecutorType: null,
      },
    };

    expect(index.resolve(machineObservation)).toBeUndefined();
  });

  describe('the veto', () => {
    it('refuses a match whose object id contradicts the asset it would join', () => {
      const index = buildIdentityIdentityIndex();
      index.register('asset-1', identityObservation('obj-1', { directoryObjectId: 'obj-1', onPremSid: 'S-1-5-21-1-2-3-1001' }));

      const contradicting = identityObservation('obj-2', { directoryObjectId: 'obj-2', onPremSid: 'S-1-5-21-1-2-3-1001' });

      expect(index.disagreesWith('asset-1', contradicting)).toBe(true);
      expect(index.resolve(contradicting)).toBeUndefined();
    });

    it('does not veto on a cloud SID differing from an on-prem SID of the same account', () => {
      const index = buildIdentityIdentityIndex();
      index.register('asset-1', identityObservation('obj-1', { directoryObjectId: 'obj-1', onPremSid: 'S-1-5-21-1-2-3-1001' }));

      const sameAccountFromTheCloud = identityObservation('obj-1', { directoryObjectId: 'obj-1', cloudSid: 'S-1-12-1-9-9-9-9' });

      expect(index.disagreesWith('asset-1', sameAccountFromTheCloud)).toBe(false);
      expect(index.resolve(sameAccountFromTheCloud)).toBe('asset-1');
    });

    it('does not veto on an absence', () => {
      const index = buildIdentityIdentityIndex();
      index.register('asset-1', identityObservation('obj-1', { directoryObjectId: 'obj-1', onPremSid: 'S-1-5-21-1-2-3-1001' }));

      expect(index.disagreesWith('asset-1', identityObservation('x', { onPremSid: 'S-1-5-21-1-2-3-1001' }))).toBe(false);
    });
  });
});
