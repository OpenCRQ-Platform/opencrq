import { describe, expect, it } from 'vitest';
import type { AssetObservation, MachineAssetProperties } from './types';
import { buildAssetIdentityIndex } from './asset-identity';

let seq = 0;

const machineObservation = (
  overrides: Partial<Omit<AssetObservation, 'properties'>> & { source: string, sourceAssetId: string },
  properties: Partial<Omit<MachineAssetProperties, 'family'>> = {},
): AssetObservation => ({
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
  ...overrides,
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
    ...properties,
  },
});

describe('buildAssetIdentityIndex', () => {
  it('never joins two families, however much a common-tier value agrees', () => {
    const host = machineObservation({ source: 'openaev', sourceAssetId: 'ep-1', externalReference: 'cmdb-1' });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-host', observation: host }]);

    const aiTarget: AssetObservation = {
      ...machineObservation({ source: 'openaev', sourceAssetId: 'ai-1', externalReference: 'cmdb-1' }),
      reportedCategoryId: 'ai_target',
      properties: { family: 'ai_target', provider: null, endpointUrl: null, normalizedEndpointUrl: null, model: null, modality: null, systemPrompt: null },
    };
    expect(index.resolve(aiTarget)).toBeUndefined();
  });

  it('lets a family tier outrank the common tier, so a Defender machine id wins over a reported reference', () => {
    const defenderDevice = machineObservation({ source: 'microsoft_graph', sourceAssetId: 'mde-1' });
    const otherAsset = machineObservation({ source: 'openaev', sourceAssetId: 'ep-9', externalReference: 'cmdb-2' });
    const index = buildAssetIdentityIndex([
      { assetId: 'asset-defender', observation: defenderDevice },
      { assetId: 'asset-other', observation: otherAsset },
    ]);

    const openaevSameDevice = machineObservation(
      { source: 'openaev', sourceAssetId: 'ep-1', externalReference: 'cmdb-2' },
      { agentExternalReference: 'mde-1', agentExecutorType: 'openaev_agent_mde' },
    );
    expect(index.resolve(openaevSameDevice)).toBe('asset-defender');
  });

  it('joins on the common tier when no family tier fires and nothing contradicts it', () => {
    const known = machineObservation({ source: 'microsoft_graph', sourceAssetId: 'mde-2', externalReference: 'cmdb-3' });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: known }]);

    const incoming = machineObservation({ source: 'openaev', sourceAssetId: 'ep-2', externalReference: 'cmdb-3' });
    expect(index.resolve(incoming)).toBe('asset-1');
  });

  it('vetoes a common-tier join when the two sides name different hardware', () => {
    const known = machineObservation(
      { source: 'microsoft_graph', sourceAssetId: 'mde-3', externalReference: 'cmdb-4' },
      { hardwareUuid: 'hw-a' },
    );
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: known }]);

    const incoming = machineObservation(
      { source: 'openaev', sourceAssetId: 'ep-3', externalReference: 'cmdb-4' },
      { hardwareUuid: 'hw-b' },
    );
    expect(index.resolve(incoming)).toBeUndefined();
  });

  it('never fuses an empty external reference as an identity', () => {
    const known = machineObservation({ source: 'openaev', sourceAssetId: 'ep-4', externalReference: '' });
    const index = buildAssetIdentityIndex([{ assetId: 'asset-1', observation: known }]);

    const incoming = machineObservation({ source: 'openaev', sourceAssetId: 'ep-5', externalReference: '' });
    expect(index.resolve(incoming)).toBeUndefined();
  });
});
