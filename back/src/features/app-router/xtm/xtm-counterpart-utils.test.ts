import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CounterpartProvider, XtmCounterpart } from './xtm-counterpart-utils';
import { normaliseCounterpartKey, resetCounterpartCache, resolveCounterparts, sanitiseFacts, xtmConnections } from './xtm-counterpart-utils';
import { openaevProvider, openctiProvider } from './xtm-providers';

const TENANT = '11111111-1111-4111-8111-111111111111';
const STIX = 'intrusion-set--4f2c6c8e-0b8a-4b8e-9b1a-2f1d3c4b5a69';

const counterpart = (key: string, product: 'opencti' | 'openaev' = 'opencti'): XtmCounterpart => ({
  key, product, objectId: `id-${key}`, objectType: 'x', objectName: key, objectUrl: `https://${product}.example/${key}`, facts: [],
});

const provider = (overrides: Partial<CounterpartProvider> = {}): CounterpartProvider => ({
  product: 'opencti',
  url: 'https://opencti.example',
  isConnected: true,
  supports: () => true,
  resolve: vi.fn((_kind, keys: Array<string>) => Promise.resolve(keys.map((k) => counterpart(k)))),
  ...overrides,
});

describe('normaliseCounterpartKey', () => {
  it('normalises each kind as OpenCTI and OpenAEV do', () => {
    expect(normaliseCounterpartKey('VULNERABILITY', ' cve-2024-3400 ')).toBe('CVE-2024-3400');
    expect(normaliseCounterpartKey('ATTACK_PATTERN', 't1059.001')).toBe('T1059.001');
    expect(normaliseCounterpartKey('THREAT', STIX.toUpperCase())).toBe(STIX);
    expect(normaliseCounterpartKey('ASSET', 'Web-01.Corp')).toBe('web-01.corp');
  });

  it('refuses a key that can never match', () => {
    expect(normaliseCounterpartKey('VULNERABILITY', 'not a cve')).toBeNull();
    expect(normaliseCounterpartKey('ATTACK_PATTERN', 'T1')).toBeNull();
    expect(normaliseCounterpartKey('THREAT', 'apt28')).toBeNull();
    expect(normaliseCounterpartKey('ASSET', '   ')).toBeNull();
  });
});

describe('sanitiseFacts', () => {
  it('keeps well formed short facts only', () => {
    expect(sanitiseFacts([{ fact_key: 'findings', fact_value: '3' }, { fact_key: 'Bad Key', fact_value: '1' }, { fact_key: 'x', fact_value: '' }]))
      .toEqual([{ key: 'findings', value: '3' }]);
    expect(sanitiseFacts('nope')).toEqual([]);
  });
});

describe('resolveCounterparts', () => {
  beforeEach(() => resetCounterpartCache());

  it('resolves once and answers the next call from the cache, misses included', async () => {
    const p = provider({ resolve: vi.fn(() => Promise.resolve([counterpart('CVE-2024-3400')])) });
    const first = await resolveCounterparts(TENANT, 'VULNERABILITY', ['CVE-2024-3400', 'CVE-2023-1111'], [p]);
    const second = await resolveCounterparts(TENANT, 'VULNERABILITY', ['cve-2024-3400', 'CVE-2023-1111'], [p]);
    expect(first.map((c) => c.key)).toEqual(['CVE-2024-3400']);
    expect(second.map((c) => c.key)).toEqual(['CVE-2024-3400']);
    expect(p.resolve).toHaveBeenCalledTimes(1);
  });

  it('skips a product that is not connected or does not hold the kind', async () => {
    const off = provider({ isConnected: false });
    const other = provider({ product: 'openaev', supports: () => false });
    expect(await resolveCounterparts(TENANT, 'VULNERABILITY', ['CVE-2024-3400'], [off, other])).toEqual([]);
    expect(off.resolve).not.toHaveBeenCalled();
    expect(other.resolve).not.toHaveBeenCalled();
  });

  it('answers nothing for a failing product and does not cache the failure', async () => {
    const resolve = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([counterpart('T1059')]);
    const p = provider({ resolve });
    expect(await resolveCounterparts(TENANT, 'ATTACK_PATTERN', ['T1059'], [p])).toEqual([]);
    expect((await resolveCounterparts(TENANT, 'ATTACK_PATTERN', ['T1059'], [p])).map((c) => c.key)).toEqual(['T1059']);
  });

  it('drops a counterpart whose link is not http(s)', async () => {
    const p = provider({ resolve: vi.fn(() => Promise.resolve([{ ...counterpart('T1059'), objectUrl: 'javascript:alert(1)' }])) });
    expect(await resolveCounterparts(TENANT, 'ATTACK_PATTERN', ['T1059'], [p])).toEqual([]);
  });

  it('never calls a product with no valid key', async () => {
    const p = provider();
    expect(await resolveCounterparts(TENANT, 'THREAT', ['apt28'], [p])).toEqual([]);
    expect(p.resolve).not.toHaveBeenCalled();
  });
});

describe('xtmConnections', () => {
  it('reports each product without its credential', () => {
    const connections = xtmConnections([
      openctiProvider({ url: 'https://opencti.example/', token: 'secret' }),
      openaevProvider(undefined),
    ]);
    expect(connections).toEqual([
      { product: 'opencti', connected: true, url: 'https://opencti.example' },
      { product: 'openaev', connected: false, url: null },
    ]);
    expect(JSON.stringify(connections)).not.toContain('secret');
  });
});

describe('providers', () => {
  it('asks OpenAEV its reverse lookup and keeps only the keys asked', async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response(JSON.stringify([
      { object_key: 'cve-2024-3400', object_id: 'v1', object_type: 'vulnerability', object_name: 'PAN-OS', object_url: 'https://openaev.example/v/v1', object_facts: [{ fact_key: 'findings', fact_value: '2' }] },
      { object_key: 'CVE-2000-0001', object_id: 'v2', object_url: 'https://openaev.example/v/v2' },
    ]))));
    const p = openaevProvider({ url: 'https://openaev.example', token: 't' }, fetchImpl);
    const found = await p.resolve('VULNERABILITY', ['CVE-2024-3400']);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://openaev.example/api/tenants/2cffad3a-0001-4078-b0e2-ef74274022c3/xtm/objects/vulnerabilities');
    expect(found).toEqual([{ key: 'CVE-2024-3400', product: 'openaev', objectId: 'v1', objectType: 'vulnerability', objectName: 'PAN-OS', objectUrl: 'https://openaev.example/v/v1', facts: [{ key: 'findings', value: '2' }] }]);
  });

  it('asks OpenCTI by STIX id and links to the object', async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response(JSON.stringify({ data: { stixCoreObjects: { edges: [
      { node: { id: 'abc', standard_id: STIX, entity_type: 'Intrusion-Set', representative: { main: 'APT28' } } },
    ] } } }))));
    const p = openctiProvider({ url: 'https://opencti.example/', token: 't' }, fetchImpl);
    const found = await p.resolve('THREAT', [STIX]);
    expect(found).toEqual([{ key: STIX, product: 'opencti', objectId: 'abc', objectType: 'Intrusion-Set', objectName: 'APT28', objectUrl: 'https://opencti.example/dashboard/id/abc', facts: [] }]);
  });

  it('fails the lookup on an error status, without the token in the message', async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response('no', { status: 401 })));
    const p = openaevProvider({ url: 'https://openaev.example', token: 'secret-token' }, fetchImpl);
    await expect(p.resolve('ASSET', ['web-01'])).rejects.toThrow(/401/);
    await expect(p.resolve('ASSET', ['web-01'])).rejects.not.toThrow(/secret-token/);
  });
});
