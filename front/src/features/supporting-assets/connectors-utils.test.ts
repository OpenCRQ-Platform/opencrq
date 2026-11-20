import { describe, expect, it } from 'vitest';
import { buildLinks, buildOpenCtiObjectLink, canResyncWithConnectors, hasLiveConnectorSource } from './connectors-utils';

describe('hasLiveConnectorSource', () => {
  it('is false with no sources at all', () => {
    expect(hasLiveConnectorSource([])).toBe(false);
  });

  it('is false when every source survived its connector\'s deletion', () => {
    expect(hasLiveConnectorSource([{ connectorId: null }, { connectorId: null }])).toBe(false);
  });

  it('is true as soon as one source still has a live connector', () => {
    expect(hasLiveConnectorSource([{ connectorId: null }, { connectorId: 'conn-1' }])).toBe(true);
  });
});

describe('canResyncWithConnectors', () => {
  it('is false on an asset nothing was set on by hand', () => {
    expect(canResyncWithConnectors(0, [{ connectorId: 'conn-1' }])).toBe(false);
  });

  it('is false on a hand-created asset, whose only source is its own manual one', () => {
    expect(canResyncWithConnectors(2, [{ connectorId: null }])).toBe(false);
  });

  it('is false once the connector that observed the asset was deleted', () => {
    expect(canResyncWithConnectors(2, [{ connectorId: null }, { connectorId: null }])).toBe(false);
  });

  it('is true with a hand-set field and a live connector observing the asset', () => {
    expect(canResyncWithConnectors(1, [{ connectorId: null }, { connectorId: 'conn-1' }])).toBe(true);
  });
});

describe('buildLinks', () => {
  it('builds OpenAEV URLs correctly when base URL ends with a slash', () => {
    const links = buildLinks({
      connectorSource: 'openaev',
      openaevUrl: 'https://openaev.example.com/',
      sourceScenarioId: 'sc-1',
      sourceSimulationId: 'sim-1',
      sourceInjectId: 'inj-1',
      sourceFindingId: 'sa-1:CVE-2024-1234',
      externalReference: 'finding-1',
    });

    expect(links.scenario).toBe('https://openaev.example.com/admin/scenarios/sc-1');
    expect(links.simulation).toBe('https://openaev.example.com/admin/simulations/sim-1');
    expect(links.inject).toBe('https://openaev.example.com/admin/simulations/sim-1/injects/inj-1');
    expect(links.finding).toBe('https://openaev.example.com/admin/findings/finding-1');
  });

  it('builds no OpenAEV finding link from our own provenance key', () => {
    const links = buildLinks({
      connectorSource: 'openaev',
      openaevUrl: 'https://openaev.example.com',
      sourceScenarioId: 'sc-1',
      sourceSimulationId: 'sim-1',
      sourceInjectId: 'inj-1',
      sourceFindingId: 'scenario-sc-1',
      externalReference: null,
    });

    expect(links.finding).toBeUndefined();
  });

  it('returns an empty object when OpenAEV base URL is invalid', () => {
    const links = buildLinks({
      connectorSource: 'openaev',
      openaevUrl: '::not-a-url::',
      sourceScenarioId: 'sc-1',
      sourceSimulationId: 'sim-1',
      sourceInjectId: 'inj-1',
      sourceFindingId: 'finding-1',
    });

    expect(links).toEqual({});
  });
});

describe('buildLinks for Microsoft Defender', () => {
  const defenderFinding = {
    connectorSource: 'microsoft_graph',
    sourceScenarioId: null,
    sourceSimulationId: null,
    sourceInjectId: null,
  };

  it('links the device Defender reported and the CVE taken from the canonical source key', () => {
    const links = buildLinks({
      ...defenderFinding,
      sourceFindingId: '0192f5a0-7c1e-7a4b-9d3e-5f6a7b8c9d0e:CVE-2024-1234',
      externalReference: 'device-abc123',
    });

    const url = new URL(links.finding!);
    expect(url.origin + url.pathname).toBe('https://security.microsoft.com/vulnerabilities');
    expect(url.searchParams.get('deviceId')).toBe('device-abc123');
    expect(url.searchParams.get('cveId')).toBe('CVE-2024-1234');
  });

  it('builds no link from a source not yet resynchronised, which carries no device id', () => {
    expect(buildLinks({
      ...defenderFinding,
      sourceFindingId: '0192f5a0-7c1e-7a4b-9d3e-5f6a7b8c9d0e:CVE-2024-1234',
      externalReference: null,
    })).toEqual({});
    expect(buildLinks({
      ...defenderFinding,
      sourceFindingId: '0192f5a0-7c1e-7a4b-9d3e-5f6a7b8c9d0e:CVE-2024-1234',
    })).toEqual({});
  });

  it('never reads the asset id of the canonical key as a device', () => {
    const assetId = '0192f5a0-7c1e-7a4b-9d3e-5f6a7b8c9d0e';
    const links = buildLinks({
      ...defenderFinding,
      sourceFindingId: `${assetId}:CVE-2024-1234`,
      externalReference: 'device-abc123',
    });

    expect(links.finding).not.toContain(assetId);
  });

  it('builds no link without a CVE after the last colon', () => {
    expect(buildLinks({ ...defenderFinding, sourceFindingId: null, externalReference: 'device-abc123' })).toEqual({});
    expect(buildLinks({ ...defenderFinding, sourceFindingId: 'no-separator', externalReference: 'device-abc123' })).toEqual({});
    expect(buildLinks({ ...defenderFinding, sourceFindingId: 'asset:', externalReference: 'device-abc123' })).toEqual({});
  });
});

const VULNERABILITY_STIX_ID = 'vulnerability--0f2b1e3c-4a5d-4e6f-8a9b-0c1d2e3f4a5b';
const THREAT_STIX_ID = 'intrusion-set--9f8e7d6c-5b4a-4392-8271-6a5b4c3d2e1f';

describe('buildOpenCtiObjectLink', () => {
  it('resolves a STIX id through the universal id route', () => {
    expect(buildOpenCtiObjectLink('https://opencti.example.com', VULNERABILITY_STIX_ID))
      .toBe(`https://opencti.example.com/dashboard/id/${VULNERABILITY_STIX_ID}`);
  });

  it('keeps a base URL served under a path prefix', () => {
    expect(buildOpenCtiObjectLink('https://example.com/opencti/', THREAT_STIX_ID))
      .toBe(`https://example.com/opencti/dashboard/id/${THREAT_STIX_ID}`);
  });

  it('keeps a path prefix written without its trailing slash', () => {
    expect(buildOpenCtiObjectLink('https://example.com/opencti', THREAT_STIX_ID))
      .toBe(`https://example.com/opencti/dashboard/id/${THREAT_STIX_ID}`);
  });

  it('builds no link when the platform is not configured', () => {
    expect(buildOpenCtiObjectLink(null, VULNERABILITY_STIX_ID)).toBeNull();
    expect(buildOpenCtiObjectLink('   ', VULNERABILITY_STIX_ID)).toBeNull();
  });

  it('builds no link when the object carries no STIX id', () => {
    expect(buildOpenCtiObjectLink('https://opencti.example.com', null)).toBeNull();
  });

  it('builds no link from an id OpenCTI could not have generated', () => {
    expect(buildOpenCtiObjectLink('https://opencti.example.com', 'intrusion-set--seed-salt-typhoon')).toBeNull();
    expect(buildOpenCtiObjectLink('https://opencti.example.com', 'intrusion-set--42')).toBeNull();
    expect(buildOpenCtiObjectLink('https://opencti.example.com', '9f8e7d6c-5b4a-4392-8271-6a5b4c3d2e1f')).toBeNull();
  });

  it('builds no link from an unusable base URL', () => {
    expect(buildOpenCtiObjectLink('::not-a-url::', VULNERABILITY_STIX_ID)).toBeNull();
  });
});
