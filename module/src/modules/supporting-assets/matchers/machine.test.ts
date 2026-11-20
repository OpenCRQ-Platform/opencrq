import { describe, expect, it } from 'vitest';
import type { AssetObservation, MachineAssetProperties } from '../types';
import { buildAssetIdentityIndex } from '../asset-identity';

let seq = 0;

type FlatObservation = Omit<AssetObservation, 'properties'> & Omit<MachineAssetProperties, 'family'>;

const observation = (overrides: Partial<FlatObservation> & { source: string, sourceAssetId: string }): AssetObservation => {
  const merged: FlatObservation = {
    id: `obs-${seq++}`,
    connectorId: `connector-${overrides.source}`,
    origin: 'connector',
    reportedName: null,
    reportedCategoryId: 'host',
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
    ...overrides,
  };
  const {
    hostname, ipAddresses, macAddresses, seenIp, hardwareUuid, directoryDeviceId,
    cloudVmId, cloudResourceId, cloudProvider, cloudNativeType, cloudRegion,
    platform, arch, vendor, model, operatingSystem, osVersion, isEol, agentExternalReference, agentExecutorType,
    ...common
  } = merged;
  return {
    ...common,
    properties: {
      family: 'machine',
      hostname,
      ipAddresses,
      macAddresses,
      seenIp,
      hardwareUuid,
      directoryDeviceId,
      cloudVmId,
      cloudResourceId,
      cloudProvider,
      cloudNativeType,
      cloudRegion,
      platform,
      arch,
      vendor,
      model,
      operatingSystem,
      osVersion,
      isEol,
      agentExternalReference,
      agentExecutorType,
    },
  };
};

describe('buildAssetIdentityIndex', () => {
  it('tier 0: joins a Graph device to the OpenAEV agent it registered through MDE', () => {
    const graphObs = observation({ source: 'microsoft_graph', sourceAssetId: 'device-123' });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: graphObs }]);

    const openaevObs = observation({
      source: 'openaev', sourceAssetId: 'ep-1', agentExternalReference: 'device-123', agentExecutorType: 'mde_executor',
    });
    expect(index.resolve(openaevObs)).toBe('asset-1');
  });

  it('tier 0 never fires without the MDE qualification', () => {
    const graphObs = observation({ source: 'microsoft_graph', sourceAssetId: 'device-123' });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: graphObs }]);

    const openaevObs = observation({
      source: 'openaev', sourceAssetId: 'ep-1', agentExternalReference: 'device-123', agentExecutorType: 'crowdstrike',
    });
    expect(index.resolve(openaevObs)).toBeUndefined();
  });

  it('tier 2: joins on a physical MAC overlap', () => {
    const openaevObs = observation({
      source: 'openaev', sourceAssetId: 'ep-1', macAddresses: ['aabbccddee01'],
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: openaevObs }]);

    const graphObs = observation({
      source: 'microsoft_graph', sourceAssetId: 'device-999', macAddresses: ['aabbccddee01'],
    });
    expect(index.resolve(graphObs)).toBe('asset-1');
  });

  it('tier 2 refuses two clones sharing a virtualised OUI MAC (already stripped by normalization)', () => {
    // A caller normalising with normalizeMac would never carry a VMware MAC into an observation.
    const cloneA = observation({ source: 'microsoft_graph', sourceAssetId: 'device-a', macAddresses: [] });
    const cloneB = observation({ source: 'microsoft_graph', sourceAssetId: 'device-b', macAddresses: [] });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-a', observation: cloneA }]);
    expect(index.resolve(cloneB)).toBeUndefined();
  });

  it('tier 2 refuses a MAC overlap between two disagreeing hostnames (a shared docking station)', () => {
    const laptopA = observation({
      source: 'openaev', sourceAssetId: 'ep-1', hostname: 'laptop-a.corp.local', macAddresses: ['aabbccddee01'],
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: laptopA }]);

    const laptopB = observation({
      source: 'microsoft_graph', sourceAssetId: 'device-999', hostname: 'laptop-b.corp.local', macAddresses: ['aabbccddee01'],
    });
    expect(index.resolve(laptopB)).toBeUndefined();
  });

  it('tier 2 still joins when one side reports the short name of the other\'s FQDN', () => {
    const openaevObs = observation({
      source: 'openaev', sourceAssetId: 'ep-1', hostname: 'laptop-a', macAddresses: ['aabbccddee01'],
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: openaevObs }]);

    const graphObs = observation({
      source: 'microsoft_graph', sourceAssetId: 'device-999', hostname: 'laptop-a.corp.local', macAddresses: ['aabbccddee01'],
    });
    expect(index.resolve(graphObs)).toBe('asset-1');
  });

  it('tier 2 joins on a MAC overlap the platform alone would have vetoed', () => {
    // The two connectors' OS vocabularies barely overlap, so a platform disagreement is no
    // evidence of two machines: the MAC and the agreeing hostname decide.
    const linuxHost = observation({
      source: 'openaev', sourceAssetId: 'ep-1', hostname: 'srv01', platform: 'linux', macAddresses: ['aabbccddee01'],
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: linuxHost }]);

    const windowsHost = observation({
      source: 'microsoft_graph', sourceAssetId: 'device-999', hostname: 'srv01', platform: 'windows', macAddresses: ['aabbccddee01'],
    });
    expect(index.resolve(windowsHost)).toBe('asset-1');
  });

  it('tier 3: joins on hostname plus platform plus an IP overlap', () => {
    const graphObs = observation({
      source: 'microsoft_graph', sourceAssetId: 'device-1', hostname: 'srv01.corp.local', platform: 'windows', ipAddresses: ['10.0.0.5'],
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: graphObs }]);

    const openaevObs = observation({
      source: 'openaev', sourceAssetId: 'ep-1', hostname: 'srv01.corp.local', platform: 'windows', ipAddresses: ['10.0.0.5'],
    });
    expect(index.resolve(openaevObs)).toBe('asset-1');
  });

  it('tier 3 never fires on a bare hostname match with no platform agreement', () => {
    const graphObs = observation({
      source: 'microsoft_graph', sourceAssetId: 'device-1', hostname: 'win-default', platform: 'windows', ipAddresses: ['10.0.0.5'],
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: graphObs }]);

    const openaevObs = observation({
      source: 'openaev', sourceAssetId: 'ep-1', hostname: 'win-default', platform: 'linux', ipAddresses: ['10.0.0.5'],
    });
    expect(index.resolve(openaevObs)).toBeUndefined();
  });

  it('tier 3 never fires on a bare hostname collision with no address overlap', () => {
    const graphObs = observation({
      source: 'microsoft_graph', sourceAssetId: 'device-1', hostname: 'win-default', platform: 'windows', ipAddresses: ['10.0.0.5'],
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: graphObs }]);

    const openaevObs = observation({
      source: 'openaev', sourceAssetId: 'ep-2', hostname: 'win-default', platform: 'windows', ipAddresses: ['10.0.0.6'],
    });
    expect(index.resolve(openaevObs)).toBeUndefined();
  });

  it('tier 3 never fires on a bare hostname even with agreeing platform and an overlapping address', () => {
    // A recycled short name plus a recycled address plus a matching platform must not merge two
    // distinct machines: tier 3 requires an FQDN, never a bare hostname.
    const graphObs = observation({
      source: 'microsoft_graph', sourceAssetId: 'device-1', hostname: 'dell', platform: 'windows', ipAddresses: ['10.0.0.5'],
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: graphObs }]);

    const openaevObs = observation({
      source: 'openaev', sourceAssetId: 'ep-1', hostname: 'dell', platform: 'windows', ipAddresses: ['10.0.0.5'],
    });
    expect(index.resolve(openaevObs)).toBeUndefined();
  });

  it('tier 3 never fires on a hostname that is really an address, however qualified it looks', () => {
    // Two sites reusing a private range each announce 10.0.0.5 as their own name, and the address
    // overlap tier 3 asks for is exactly that same reused IP.
    const siteA = observation({
      source: 'microsoft_graph', sourceAssetId: 'device-1', hostname: '10.0.0.5', platform: 'windows', ipAddresses: ['10.0.0.5'],
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: siteA }]);

    const siteB = observation({
      source: 'openaev', sourceAssetId: 'ep-1', hostname: '10.0.0.5', platform: 'windows', ipAddresses: ['10.0.0.5'],
    });
    expect(index.resolve(siteB)).toBeUndefined();
  });

  it('tier 1: resolves on a hardware uuid alone, with nothing else in common', () => {
    const graphObs = observation({ source: 'microsoft_graph', sourceAssetId: 'device-1', hardwareUuid: 'uuid-a' });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: graphObs }]);

    const openaevObs = observation({ source: 'openaev', sourceAssetId: 'ep-1', hardwareUuid: 'uuid-a' });
    expect(index.resolve(openaevObs)).toBe('asset-1');
  });

  it.each([
    ['directoryDeviceId' as const, 'aad-1'],
    ['cloudVmId' as const, 'vm-1'],
    ['cloudResourceId' as const, '/subscriptions/s/resourceGroups/rg/providers/p/vm-1'],
  ])('tier 1: resolves on %s alone', (kind, value) => {
    const graphObs = observation({ source: 'microsoft_graph', sourceAssetId: 'device-1', [kind]: value });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: graphObs }]);

    const openaevObs = observation({ source: 'openaev', sourceAssetId: 'ep-1', [kind]: value });
    expect(index.resolve(openaevObs)).toBe('asset-1');
  });

  it('tier 1 never conflates two kinds sharing a value: a hardware uuid is not a cloud vm id', () => {
    const graphObs = observation({ source: 'microsoft_graph', sourceAssetId: 'device-1', hardwareUuid: 'shared-value' });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: graphObs }]);

    const openaevObs = observation({ source: 'openaev', sourceAssetId: 'ep-1', cloudVmId: 'shared-value' });
    expect(index.resolve(openaevObs)).toBeUndefined();
  });

  it('tier 1 resolves onto the asset its strongest kind names when two kinds disagree on the target', () => {
    const byHardware = observation({ source: 'microsoft_graph', sourceAssetId: 'device-1', hardwareUuid: 'uuid-a' });
    const byCloud = observation({ source: 'microsoft_graph', sourceAssetId: 'device-2', cloudVmId: 'vm-1' });
    const index = buildAssetIdentityIndex([
      { assetId: 'asset-hardware', observation: byHardware },
      { assetId: 'asset-cloud', observation: byCloud },
    ]);

    const both = observation({ source: 'openaev', sourceAssetId: 'ep-1', hardwareUuid: 'uuid-a', cloudVmId: 'vm-1' });
    expect(index.resolve(both)).toBe('asset-hardware');
  });

  it('vetoes a tier-1 match when the two sides carry disagreeing Defender machine ids', () => {
    const graphObs = observation({ source: 'microsoft_graph', sourceAssetId: 'device-1', hardwareUuid: 'uuid-a' });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: graphObs }]);

    const otherDevice = observation({ source: 'microsoft_graph', sourceAssetId: 'device-2', hardwareUuid: 'uuid-a' });
    expect(index.resolve(otherDevice)).toBeUndefined();
  });

  it('lets a tier-1 match stand when only one side names a Defender machine id', () => {
    const openaevObs = observation({ source: 'openaev', sourceAssetId: 'ep-1', hardwareUuid: 'uuid-a' });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: openaevObs }]);

    const graphObs = observation({ source: 'microsoft_graph', sourceAssetId: 'device-1', hardwareUuid: 'uuid-a' });
    expect(index.resolve(graphObs)).toBe('asset-1');
  });

  it('lets a tier-1 match stand across a re-enrollment, where a second kind legitimately disagrees', () => {
    const beforeReenrollment = observation({
      source: 'microsoft_graph', sourceAssetId: 'device-1', hardwareUuid: 'uuid-a', directoryDeviceId: 'aad-old',
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: beforeReenrollment }]);

    const afterReenrollment = observation({
      source: 'openaev', sourceAssetId: 'ep-1', hardwareUuid: 'uuid-a', directoryDeviceId: 'aad-new',
    });
    expect(index.resolve(afterReenrollment)).toBe('asset-1');
  });

  it('vetoes a tier-3 match when both sides carry disagreeing hardware UUIDs', () => {
    const graphObs = observation({
      source: 'microsoft_graph', sourceAssetId: 'device-1', hostname: 'srv01', platform: 'windows', ipAddresses: ['10.0.0.5'], hardwareUuid: 'uuid-a',
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: graphObs }]);

    const openaevObs = observation({
      source: 'openaev', sourceAssetId: 'ep-1', hostname: 'srv01', platform: 'windows', ipAddresses: ['10.0.0.5'], hardwareUuid: 'uuid-b',
    });
    expect(index.resolve(openaevObs)).toBeUndefined();
  });

  it('vetoes a tier-2 MAC match when both sides carry disagreeing hardware UUIDs', () => {
    const graphObs = observation({
      source: 'microsoft_graph', sourceAssetId: 'device-1', macAddresses: ['aabbccddee01'], hardwareUuid: 'uuid-a',
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: graphObs }]);

    const openaevObs = observation({
      source: 'openaev', sourceAssetId: 'ep-1', macAddresses: ['aabbccddee01'], hardwareUuid: 'uuid-b',
    });
    expect(index.resolve(openaevObs)).toBeUndefined();
  });

  it.each([
    ['directoryDeviceId' as const, 'aad-a', 'aad-b'],
    ['cloudVmId' as const, 'vm-a', 'vm-b'],
    ['cloudResourceId' as const, '/subscriptions/a/vm', '/subscriptions/b/vm'],
  ])('vetoes a tier-2 MAC match when both sides carry disagreeing %s values', (kind, mine, theirs) => {
    const graphObs = observation({
      source: 'microsoft_graph', sourceAssetId: 'device-1', macAddresses: ['aabbccddee01'], [kind]: mine,
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: graphObs }]);

    const openaevObs = observation({
      source: 'openaev', sourceAssetId: 'ep-1', macAddresses: ['aabbccddee01'], [kind]: theirs,
    });
    expect(index.resolve(openaevObs)).toBeUndefined();
  });

  it.each([
    ['directoryDeviceId' as const, 'aad-a', 'aad-b'],
    ['cloudVmId' as const, 'vm-a', 'vm-b'],
    ['cloudResourceId' as const, '/subscriptions/a/vm', '/subscriptions/b/vm'],
  ])('vetoes a tier-3 match when both sides carry disagreeing %s values', (kind, mine, theirs) => {
    const graphObs = observation({
      source: 'microsoft_graph',
      sourceAssetId: 'device-1',
      hostname: 'srv01.corp.local',
      platform: 'windows',
      ipAddresses: ['10.0.0.5'],
      [kind]: mine,
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: graphObs }]);

    const openaevObs = observation({
      source: 'openaev',
      sourceAssetId: 'ep-1',
      hostname: 'srv01.corp.local',
      platform: 'windows',
      ipAddresses: ['10.0.0.5'],
      [kind]: theirs,
    });
    expect(index.resolve(openaevObs)).toBeUndefined();
  });

  it('vetoes a tier-2 MAC match when the two sides carry disagreeing Defender machine ids', () => {
    const deviceA = observation({ source: 'microsoft_graph', sourceAssetId: 'device-a', macAddresses: ['aabbccddee01'] });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: deviceA }]);

    const otherAgent = observation({
      source: 'openaev',
      sourceAssetId: 'ep-1',
      macAddresses: ['aabbccddee01'],
      agentExternalReference: 'device-b',
      agentExecutorType: 'mde_executor',
    });
    expect(index.resolve(otherAgent)).toBeUndefined();
  });

  it('vetoes a tier-3 match when the two sides carry disagreeing Defender machine ids', () => {
    const deviceA = observation({
      source: 'microsoft_graph', sourceAssetId: 'device-a', hostname: 'srv01.corp.local', platform: 'windows', ipAddresses: ['10.0.0.5'],
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: deviceA }]);

    const otherAgent = observation({
      source: 'openaev',
      sourceAssetId: 'ep-1',
      hostname: 'srv01.corp.local',
      platform: 'windows',
      ipAddresses: ['10.0.0.5'],
      agentExternalReference: 'device-b',
      agentExecutorType: 'mde_executor',
    });
    expect(index.resolve(otherAgent)).toBeUndefined();
  });

  it('never registers an unmatchable family, so a machine cannot later be served an identity row it shares a MAC with', () => {
    const account = observation({
      source: 'microsoft_graph', sourceAssetId: 'user-1', reportedCategoryId: 'identity', macAddresses: ['aabbccddee01'],
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-identity', observation: account }]);

    const machine = observation({ source: 'openaev', sourceAssetId: 'ep-1', macAddresses: ['aabbccddee01'] });
    expect(index.resolve(machine)).toBeUndefined();
  });

  it('never resolves an unmatchable family onto the machine it shares a MAC with', () => {
    const machine = observation({ source: 'microsoft_graph', sourceAssetId: 'device-1', macAddresses: ['aabbccddee01'] });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: machine }]);

    const application = observation({
      source: 'openaev', sourceAssetId: 'app-1', reportedCategoryId: 'saas_application', macAddresses: ['aabbccddee01'],
    });
    expect(index.resolve(application)).toBeUndefined();
  });

  it('never matches an unclassified/dormant identifier family: two identical hostnames with no other agreement never join without a register', () => {
    const index = buildAssetIdentityIndex([]);
    const lone = observation({ source: 'microsoft_graph', sourceAssetId: 'device-1', hostname: 'anything', platform: 'windows' });
    expect(index.resolve(lone)).toBeUndefined();
  });

  it('never joins two observations on a shared empty tier-1 identifier (Advanced Hunting serializes an absent one as "")', () => {
    const first = observation({
      source: 'microsoft_graph', sourceAssetId: 'device-1', hardwareUuid: '', directoryDeviceId: '',
    });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: first }]);

    const second = observation({
      source: 'microsoft_graph', sourceAssetId: 'device-2', hardwareUuid: '', directoryDeviceId: '',
    });
    expect(index.resolve(second)).toBeUndefined();
  });

  it('registers additively so a later observation in the same batch resolves against an earlier one', () => {
    const index = buildAssetIdentityIndex([]);
    const first = observation({ source: 'microsoft_graph', sourceAssetId: 'device-1', macAddresses: ['aabbccddee01'] });
    expect(index.resolve(first)).toBeUndefined();
    index.register('asset-1', first);

    const second = observation({ source: 'openaev', sourceAssetId: 'ep-1', macAddresses: ['aabbccddee01'] });
    expect(index.resolve(second)).toBe('asset-1');
  });
});
