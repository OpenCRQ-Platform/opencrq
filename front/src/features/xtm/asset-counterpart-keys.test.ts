import { describe, expect, it } from 'vitest';
import { assetCounterpartKeys } from './asset-counterpart-keys';

describe('assetCounterpartKeys', () => {
  it('finds a web application with no hostname property by its source reference and its name', () => {
    expect(assetCounterpartKeys({
      name: '00e80886.octi.example.io',
      properties: null,
      sources: [{ source: 'openaev', sourceAssetId: 'a-1' }],
    })).toEqual(['openaev:a-1', '00e80886.octi.example.io']);
  });

  it('sends the hostname, the addresses and the URL host of an endpoint, each once', () => {
    expect(assetCounterpartKeys({
      name: 'SRV-01',
      url: 'https://srv-01.corp.example:8443/login',
      properties: { family: 'machine', hostname: 'srv-01', seenIp: '10.0.0.9', ipAddresses: ['10.0.0.9', '10.0.0.2'], macAddresses: ['aabbccddeeff'] },
      sources: [{ source: 'openaev', sourceAssetId: 'e-1' }, { source: 'microsoft_graph', sourceAssetId: 'mde-1' }],
    })).toEqual(['openaev:e-1', 'srv-01', 'srv-01.corp.example', '10.0.0.9', '10.0.0.2', 'aabbccddeeff']);
  });

  it('never sends a name that is not a DNS name, nor a source no other product imports', () => {
    expect(assetCounterpartKeys({
      name: 'Payroll application (prod)',
      sources: [{ source: null, sourceAssetId: 'manual-1' }, { source: 'microsoft_graph', sourceAssetId: 'mde-1' }],
    })).toEqual([]);
  });
});
