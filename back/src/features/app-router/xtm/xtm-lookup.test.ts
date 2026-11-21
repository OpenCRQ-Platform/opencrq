import { describe, expect, it, vi } from 'vitest';
import type { XtmLookupExposure, XtmLookupReader } from './xtm-lookup';
import { callerReadsLookupFacts, exposureFacts, lookupXtmObjects } from './xtm-lookup';

const STIX = 'intrusion-set--11111111-1111-1111-1111-111111111111';
const BASE = { baseUrl: 'https://crq.example.com/', tenantId: 'tenant-1', withFacts: true };

const reader = (overrides: Partial<XtmLookupReader> = {}): XtmLookupReader => ({
  threatsByStixIds: vi.fn(() => Promise.resolve([{ id: 'th-1', stixId: STIX, name: 'APT Test', entityType: 'intrusion-set' }])),
  cvesByCveIds: vi.fn(() => Promise.resolve([{ id: 'cve-row-1', cveId: 'CVE-2024-1234' }])),
  assetsByHostnames: vi.fn(() => Promise.resolve([
    { id: 'as-1', name: 'Web 01', hostname: 'web01.corp' },
    { id: 'as-1', name: 'Web 01', hostname: 'web01.corp' },
    { id: 'as-2', name: null, hostname: 'db01.corp' },
  ])),
  exposure: vi.fn(() => Promise.resolve(new Map<string, XtmLookupExposure>())),
  ...overrides,
});

describe('lookupXtmObjects', () => {
  it('answers a threat by its STIX id with its OpenCRQ page', async () => {
    const r = reader();
    const out = await lookupXtmObjects({ ...BASE, kind: 'THREAT', keys: [STIX.toUpperCase()] }, r);
    expect(r.threatsByStixIds).toHaveBeenCalledWith([STIX]);
    expect(out).toEqual([{
      object_key: STIX,
      object_id: 'th-1',
      object_type: 'intrusion-set',
      object_name: 'APT Test',
      object_url: 'https://crq.example.com/tenant-1/threat-center/threats/th-1',
      object_facts: [],
    }]);
  });

  it('answers a vulnerability by its CVE id, upper-cased', async () => {
    const r = reader();
    const out = await lookupXtmObjects({ ...BASE, kind: 'VULNERABILITY', keys: ['cve-2024-1234', 'not-a-cve'] }, r);
    expect(r.cvesByCveIds).toHaveBeenCalledWith(['CVE-2024-1234']);
    expect(out.map((o) => [o.object_key, o.object_url])).toEqual([
      ['CVE-2024-1234', 'https://crq.example.com/tenant-1/findings/cve/CVE-2024-1234'],
    ]);
  });

  it('answers an asset once per hostname, named by its hostname when it has no name', async () => {
    const out = await lookupXtmObjects({ ...BASE, kind: 'ASSET', keys: ['WEB01.corp', 'db01.corp'] }, reader());
    expect(out.map((o) => [o.object_key, o.object_id, o.object_name])).toEqual([
      ['web01.corp', 'as-1', 'Web 01'],
      ['db01.corp', 'as-2', 'db01.corp'],
    ]);
  });

  it('reads nothing when no key can match', async () => {
    const r = reader();
    expect(await lookupXtmObjects({ ...BASE, kind: 'THREAT', keys: ['APT28', ''] }, r)).toEqual([]);
    expect(r.threatsByStixIds).not.toHaveBeenCalled();
  });

  it('carries the exposure of each object found, read once per call by OpenCRQ id', async () => {
    const r = reader({
      exposure: vi.fn(() => Promise.resolve(new Map<string, XtmLookupExposure>([
        ['cve-row-1', { scenarioCount: 2, aleMean: 1_250_000.4, aleReductionMean: 300_000.6 }],
      ]))),
    });
    const out = await lookupXtmObjects({ ...BASE, kind: 'VULNERABILITY', keys: ['CVE-2024-1234'] }, r);
    expect(r.exposure).toHaveBeenCalledWith('VULNERABILITY', ['cve-row-1']);
    expect(out[0].object_facts).toEqual([
      { key: 'risk_scenarios', value: '2' },
      { key: 'annual_loss', value: '1250000' },
      { key: 'fix_value', value: '300001' },
    ]);
  });

  it('reads the exposure of a duplicated asset once', async () => {
    const r = reader();
    await lookupXtmObjects({ ...BASE, kind: 'ASSET', keys: ['web01.corp', 'db01.corp'] }, r);
    expect(r.exposure).toHaveBeenCalledWith('ASSET', ['as-1', 'as-2']);
  });

  it('reads no exposure when nothing matched', async () => {
    const r = reader({ threatsByStixIds: () => Promise.resolve([]) });
    expect(await lookupXtmObjects({ ...BASE, kind: 'THREAT', keys: [STIX] }, r)).toEqual([]);
    expect(r.exposure).not.toHaveBeenCalled();
  });

  it('gives a caller without facts the link only, and reads no exposure for it', async () => {
    const r = reader({
      exposure: vi.fn(() => Promise.resolve(new Map<string, XtmLookupExposure>([
        ['cve-row-1', { scenarioCount: 2, aleMean: 1_250_000, aleReductionMean: 300_000 }],
      ]))),
    });
    const out = await lookupXtmObjects({ ...BASE, withFacts: false, kind: 'VULNERABILITY', keys: ['CVE-2024-1234'] }, r);
    expect(r.exposure).not.toHaveBeenCalled();
    expect(out).toEqual([{
      object_key: 'CVE-2024-1234',
      object_id: 'CVE-2024-1234',
      object_type: 'vulnerability',
      object_name: 'CVE-2024-1234',
      object_url: 'https://crq.example.com/tenant-1/findings/cve/CVE-2024-1234',
      object_facts: [],
    }]);
  });

  it('gives the facts to a person only, never to a service account', () => {
    expect(callerReadsLookupFacts({ type: 'client' })).toBe(true);
    expect(callerReadsLookupFacts({ type: 'connector' })).toBe(false);
    expect(callerReadsLookupFacts({ type: 'platform' })).toBe(false);
  });

  it('leaves an unpriced figure out instead of writing a zero', () => {
    expect(exposureFacts(undefined)).toEqual([]);
    expect(exposureFacts({ scenarioCount: 0, aleMean: null, aleReductionMean: null })).toEqual([]);
    expect(exposureFacts({ scenarioCount: 3, aleMean: null, aleReductionMean: null })).toEqual([{ key: 'risk_scenarios', value: '3' }]);
  });

  it('encodes the tenant and the object id in the URL', async () => {
    const out = await lookupXtmObjects({ baseUrl: 'https://crq.example.com', tenantId: 'a/b', withFacts: true, kind: 'ASSET', keys: ['h'] }, reader({
      assetsByHostnames: () => Promise.resolve([{ id: 'x y', name: 'n', hostname: 'h' }]),
    }));
    expect(out[0].object_url).toBe('https://crq.example.com/a%2Fb/assets/x%20y');
  });
});
