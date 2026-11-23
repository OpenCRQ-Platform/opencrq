import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CounterpartProvider, XtmCounterpart } from './xtm-counterpart-utils';
import type { ReaderAuthorization } from './xtm-providers';
import { normaliseCounterpartKey, resetCounterpartCache, resolveCounterparts, sanitiseFacts, switcherProducts, xtmConnections } from './xtm-counterpart-utils';
import { openaevProvider, openctiProvider, XTM_ONE_LOOKUP_PATH, xtmOneProvider } from './xtm-providers';

const NO_READER: ReaderAuthorization = () => Promise.resolve(null);
const READER = 'reader-1';
const OTHER_READER = 'reader-2';

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
    const first = await resolveCounterparts(TENANT, READER, 'VULNERABILITY', ['CVE-2024-3400', 'CVE-2023-1111'], [p]);
    const second = await resolveCounterparts(TENANT, READER, 'VULNERABILITY', ['cve-2024-3400', 'CVE-2023-1111'], [p]);
    expect(first.map((c) => c.key)).toEqual(['CVE-2024-3400']);
    expect(second.map((c) => c.key)).toEqual(['CVE-2024-3400']);
    expect(p.resolve).toHaveBeenCalledTimes(1);
  });

  it('skips a product that is not connected or does not hold the kind', async () => {
    const off = provider({ isConnected: false });
    const other = provider({ product: 'openaev', supports: () => false });
    expect(await resolveCounterparts(TENANT, READER, 'VULNERABILITY', ['CVE-2024-3400'], [off, other])).toEqual([]);
    expect(off.resolve).not.toHaveBeenCalled();
    expect(other.resolve).not.toHaveBeenCalled();
  });

  it('answers nothing for a failing product and does not cache the failure', async () => {
    const resolve = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([counterpart('T1059')]);
    const p = provider({ resolve });
    expect(await resolveCounterparts(TENANT, READER, 'ATTACK_PATTERN', ['T1059'], [p])).toEqual([]);
    expect((await resolveCounterparts(TENANT, READER, 'ATTACK_PATTERN', ['T1059'], [p])).map((c) => c.key)).toEqual(['T1059']);
  });

  it('drops a counterpart whose link is not http(s)', async () => {
    const p = provider({ resolve: vi.fn(() => Promise.resolve([{ ...counterpart('T1059'), objectUrl: 'javascript:alert(1)' }])) });
    expect(await resolveCounterparts(TENANT, READER, 'ATTACK_PATTERN', ['T1059'], [p])).toEqual([]);
  });

  it('never serves one reader the answer another reader got: the cache is per reader', async () => {
    const p = provider({ resolve: vi.fn(() => Promise.resolve([counterpart('CVE-2024-3400')])) });
    await resolveCounterparts(TENANT, READER, 'VULNERABILITY', ['CVE-2024-3400'], [p]);
    const restricted = provider({ resolve: vi.fn(() => Promise.resolve([])) });
    expect(await resolveCounterparts(TENANT, OTHER_READER, 'VULNERABILITY', ['CVE-2024-3400'], [restricted])).toEqual([]);
    expect(restricted.resolve).toHaveBeenCalledTimes(1);
  });

  it('never calls a product with no valid key', async () => {
    const p = provider();
    expect(await resolveCounterparts(TENANT, READER, 'THREAT', ['apt28'], [p])).toEqual([]);
    expect(p.resolve).not.toHaveBeenCalled();
  });
});

describe('switcherProducts', () => {
  it('prefers the URL the deployment declares, else the connection, without a trailing slash', () => {
    const providers = [openctiProvider({ url: 'https://opencti.connection/', token: 'secret' }, NO_READER), openaevProvider({ url: 'https://openaev.connection/', token: 'secret' }, NO_READER)];
    expect(switcherProducts({ openaev_url: 'https://openaev.declared/' }, providers)).toEqual([
      { product: 'opencti', url: 'https://opencti.connection' },
      { product: 'openaev', url: 'https://openaev.declared' },
    ]);
  });

  it('answers no URL for a product neither declared nor connected', () => {
    expect(switcherProducts({}, [openctiProvider(undefined, NO_READER), openaevProvider(undefined, NO_READER)])).toEqual([
      { product: 'opencti', url: null },
      { product: 'openaev', url: null },
    ]);
  });
});

describe('xtmConnections', () => {
  it('reports each product without its credential', () => {
    const connections = xtmConnections([
      openctiProvider({ url: 'https://opencti.example/', token: 'secret' }, NO_READER),
      openaevProvider(undefined, NO_READER),
    ]);
    expect(connections).toEqual([
      { product: 'opencti', connected: true, url: 'https://opencti.example' },
      { product: 'openaev', connected: false, url: null },
    ]);
    expect(JSON.stringify(connections)).not.toContain('secret');
  });
});

const authHeaderOf = (init: RequestInit | undefined): string | undefined => new Headers(init?.headers).get('Authorization') ?? undefined;

describe('providers', () => {
  it('asks OpenAEV its reverse lookup as the reader, and keeps only the keys asked', async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response(JSON.stringify([
      { object_key: 'cve-2024-3400', object_id: 'v1', object_type: 'vulnerability', object_name: 'PAN-OS', object_url: 'https://openaev.example/v/v1', object_facts: [{ fact_key: 'findings', fact_value: '2' }] },
      { object_key: 'CVE-2000-0001', object_id: 'v2', object_url: 'https://openaev.example/v/v2' },
    ]))));
    const authorization = vi.fn((_product: string, _connection: unknown) => Promise.resolve('reader-jwt'));
    const connection = { url: 'https://openaev.example/', token: 'connector-token' };
    const p = openaevProvider(connection, authorization, fetchImpl);
    const found = await p.resolve('VULNERABILITY', ['CVE-2024-3400']);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://openaev.example/api/tenants/2cffad3a-0001-4078-b0e2-ef74274022c3/xtm/objects/vulnerabilities');
    expect(authorization).toHaveBeenCalledWith('openaev', connection);
    expect(authHeaderOf(fetchImpl.mock.calls[0][1])).toBe('Bearer reader-jwt');
    expect(found).toEqual([{ key: 'CVE-2024-3400', product: 'openaev', objectId: 'v1', objectType: 'vulnerability', objectName: 'PAN-OS', objectUrl: 'https://openaev.example/v/v1', facts: [{ key: 'findings', value: '2' }] }]);
  });

  it('asks OpenCTI by STIX id as the reader and links to the object', async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response(JSON.stringify({ data: { stixCoreObjects: { edges: [
      { node: { id: 'abc', standard_id: STIX, entity_type: 'Intrusion-Set', representative: { main: 'APT28' } } },
    ] } } }))));
    const authorization = vi.fn((_product: string, _connection: unknown) => Promise.resolve('reader-jwt'));
    const connection = { url: 'https://opencti.example/', token: 'connector-token' };
    const p = openctiProvider(connection, authorization, fetchImpl);
    const found = await p.resolve('THREAT', [STIX]);
    expect(authorization).toHaveBeenCalledWith('opencti', connection);
    expect(authHeaderOf(fetchImpl.mock.calls[0][1])).toBe('Bearer reader-jwt');
    expect(found).toEqual([{ key: STIX, product: 'opencti', objectId: 'abc', objectType: 'Intrusion-Set', objectName: 'APT28', objectUrl: 'https://opencti.example/dashboard/id/abc', facts: [] }]);
  });

  it('never sends the connector token: no reader identity means no call and no counterpart', async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response('[]')));
    const connection = { url: 'https://product.example', token: 'connector-token' };
    for (const p of [openaevProvider(connection, NO_READER, fetchImpl), openctiProvider(connection, NO_READER, fetchImpl)]) {
      expect(await p.resolve('VULNERABILITY', ['CVE-2024-3400'])).toEqual([]);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the reader bearer, never the connector token, on every lookup', async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response('[]')));
    const connection = { url: 'https://product.example', token: 'connector-token' };
    await openaevProvider(connection, () => Promise.resolve('reader-jwt'), fetchImpl).resolve('ASSET', ['web-01']);
    await openctiProvider(connection, () => Promise.resolve('reader-jwt'), fetchImpl).resolve('ASSET', ['web-01']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(JSON.stringify(init)).not.toContain('connector-token');
    }
  });

  it('fails the lookup on a refusal (the reader has no right there), without the bearer in the message', async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response('no', { status: 403 })));
    const p = openaevProvider({ url: 'https://openaev.example', token: 't' }, () => Promise.resolve('secret-reader-jwt'), fetchImpl);
    await expect(p.resolve('ASSET', ['web-01'])).rejects.toThrow(/403/);
    await expect(p.resolve('ASSET', ['web-01'])).rejects.not.toThrow(/secret-reader-jwt/);
  });
});

describe('xtmOneProvider', () => {
  const READER_HEADERS = () => Promise.resolve({ Authorization: 'Bearer reader-xtm-one-jwt', 'X-Platform-Product': 'opencrq' });

  it('looks an asset up in the XTM One inventory as the reader and keeps its criticality and category', async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response(JSON.stringify({ items: [
      { key: 'web-01', id: 'x1', name: 'web-01.corp', category: 'generic_asset', criticality: 'very_high', matches: 1, url: 'https://xtm-one.example/ctem/inventory/assets/x1' },
      { key: 'not-asked', id: 'x2', name: 'other', matches: 1, url: 'https://xtm-one.example/ctem/inventory/assets/x2' },
    ] }))));
    const p = xtmOneProvider('https://xtm-one.example/', READER_HEADERS, fetchImpl);
    expect(p.supports('ASSET')).toBe(true);
    expect(p.supports('VULNERABILITY')).toBe(false);
    const found = await p.resolve('ASSET', ['web-01']);
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://xtm-one.example${XTM_ONE_LOOKUP_PATH}`);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1].body))).toEqual({ keys: ['web-01'] });
    expect(authHeaderOf(fetchImpl.mock.calls[0][1])).toBe('Bearer reader-xtm-one-jwt');
    expect(found).toEqual([{
      key: 'web-01', product: 'xtmone', objectId: 'x1', objectType: 'asset', objectName: 'web-01.corp',
      objectUrl: 'https://xtm-one.example/ctem/inventory/assets/x1',
      facts: [{ key: 'criticality', value: 'very_high' }, { key: 'category', value: 'generic_asset' }],
    }]);
  });

  it('makes no call without a reader to sign for, nor for a kind the inventory does not hold', async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response('{}')));
    expect(await xtmOneProvider('https://xtm-one.example', () => Promise.resolve(null), fetchImpl).resolve('ASSET', ['web-01'])).toEqual([]);
    expect(await xtmOneProvider('https://xtm-one.example', READER_HEADERS, fetchImpl).resolve('VULNERABILITY', ['CVE-2024-3400'])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(xtmOneProvider(null, READER_HEADERS, fetchImpl).isConnected).toBe(false);
  });

  it('fails on a refusal without the reader token in the message, and drops a link that is not http(s)', async () => {
    const refused = xtmOneProvider('https://xtm-one.example', READER_HEADERS, vi.fn(() => Promise.resolve(new Response('no', { status: 401 }))));
    await expect(refused.resolve('ASSET', ['web-01'])).rejects.toThrow(/401/);
    await expect(refused.resolve('ASSET', ['web-01'])).rejects.not.toThrow(/reader-xtm-one-jwt/);
    const script = xtmOneProvider('https://xtm-one.example', READER_HEADERS, vi.fn(() => Promise.resolve(new Response(JSON.stringify({ items: [
      { key: 'web-01', id: 'x1', name: 'web-01', url: 'javascript:alert(1)' },
    ] })))));
    expect(await script.resolve('ASSET', ['web-01'])).toEqual([]);
  });
});
