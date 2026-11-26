import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CounterpartProvider, XtmCounterpart } from './xtm-counterpart-utils';
import type { ReaderAuthorization } from './xtm-providers';
import { normaliseCounterpartKey, resetCounterpartCache, resolveCounterparts, sanitiseFacts, xtmConnections } from './xtm-counterpart-utils';
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
    expect(first.counterparts.map((c) => c.key)).toEqual(['CVE-2024-3400']);
    expect(second.counterparts.map((c) => c.key)).toEqual(['CVE-2024-3400']);
    expect(p.resolve).toHaveBeenCalledTimes(1);
  });

  it('skips a product that is not connected or does not hold the kind', async () => {
    const off = provider({ isConnected: false });
    const other = provider({ product: 'openaev', supports: () => false });
    expect(await resolveCounterparts(TENANT, READER, 'VULNERABILITY', ['CVE-2024-3400'], [off, other])).toEqual({ counterparts: [], unavailable: [] });
    expect(off.resolve).not.toHaveBeenCalled();
    expect(other.resolve).not.toHaveBeenCalled();
  });

  it('answers nothing for a failing product and does not cache the failure', async () => {
    const resolve = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([counterpart('T1059')]);
    const p = provider({ resolve });
    expect(await resolveCounterparts(TENANT, READER, 'ATTACK_PATTERN', ['T1059'], [p])).toEqual({ counterparts: [], unavailable: ['opencti'] });
    expect(await resolveCounterparts(TENANT, READER, 'ATTACK_PATTERN', ['T1059'], [p])).toMatchObject({ counterparts: [{ key: 'T1059' }], unavailable: [] });
  });

  it('names each product that failed, and only those, whatever the others answered', async () => {
    const down = provider({ product: 'openaev', resolve: vi.fn().mockRejectedValue(new Error('timeout')) });
    const up = provider({ resolve: vi.fn(() => Promise.resolve([counterpart('T1059')])) });
    expect(await resolveCounterparts(TENANT, READER, 'ATTACK_PATTERN', ['T1059'], [up, down])).toMatchObject({ counterparts: [{ key: 'T1059' }], unavailable: ['openaev'] });
  });

  it('drops a counterpart whose link is not http(s)', async () => {
    const p = provider({ resolve: vi.fn(() => Promise.resolve([{ ...counterpart('T1059'), objectUrl: 'javascript:alert(1)' }])) });
    expect((await resolveCounterparts(TENANT, READER, 'ATTACK_PATTERN', ['T1059'], [p])).counterparts).toEqual([]);
  });

  it('never serves one reader the answer another reader got: the cache is per reader', async () => {
    const p = provider({ resolve: vi.fn(() => Promise.resolve([counterpart('CVE-2024-3400')])) });
    await resolveCounterparts(TENANT, READER, 'VULNERABILITY', ['CVE-2024-3400'], [p]);
    const restricted = provider({ resolve: vi.fn(() => Promise.resolve([])) });
    expect((await resolveCounterparts(TENANT, OTHER_READER, 'VULNERABILITY', ['CVE-2024-3400'], [restricted])).counterparts).toEqual([]);
    expect(restricted.resolve).toHaveBeenCalledTimes(1);
  });

  it('asks every product at once, so a slow one does not hold the others back, and answers in product order', async () => {
    let answerSlow: (found: Array<XtmCounterpart>) => void = () => undefined;
    const slow = provider({ resolve: vi.fn(() => new Promise<Array<XtmCounterpart>>((done) => {
      answerSlow = done;
    })) });
    const fast = provider({ product: 'openaev', resolve: vi.fn(() => Promise.resolve([counterpart('T1059', 'openaev')])) });

    const pending = resolveCounterparts(TENANT, READER, 'ATTACK_PATTERN', ['T1059'], [slow, fast]);
    await Promise.resolve();
    expect(fast.resolve).toHaveBeenCalledTimes(1);

    answerSlow([counterpart('T1059')]);
    expect((await pending).counterparts.map((c) => c.product)).toEqual(['opencti', 'openaev']);
  });

  it('answers without a product past its budget, names it unavailable, and does not cache it as a miss', async () => {
    const stuck = provider({ resolve: vi.fn(() => new Promise<Array<XtmCounterpart>>(() => undefined)) });
    const fast = provider({ product: 'openaev', resolve: vi.fn(() => Promise.resolve([counterpart('T1059', 'openaev')])) });

    const found = await resolveCounterparts(TENANT, READER, 'ATTACK_PATTERN', ['T1059'], [stuck, fast], Date.now, 10);
    expect(found.counterparts.map((c) => c.product)).toEqual(['openaev']);
    expect(found.unavailable).toEqual(['opencti']);

    await resolveCounterparts(TENANT, READER, 'ATTACK_PATTERN', ['T1059'], [stuck, fast], Date.now, 10);
    expect(stuck.resolve).toHaveBeenCalledTimes(2);
    expect(fast.resolve).toHaveBeenCalledTimes(1);
  });

  it('caches an answer that arrives past the budget, so the next page shows it without asking again', async () => {
    let answerLate: (found: Array<XtmCounterpart>) => void = () => undefined;
    const late = provider({ resolve: vi.fn(() => new Promise<Array<XtmCounterpart>>((done) => {
      answerLate = done;
    })) });

    expect(await resolveCounterparts(TENANT, READER, 'ATTACK_PATTERN', ['T1059', 'T1003'], [late], Date.now, 10))
      .toEqual({ counterparts: [], unavailable: ['opencti'] });
    answerLate([counterpart('T1059')]);
    await Promise.resolve();

    expect(await resolveCounterparts(TENANT, READER, 'ATTACK_PATTERN', ['T1059', 'T1003'], [late], Date.now, 10))
      .toMatchObject({ counterparts: [{ key: 'T1059', product: 'opencti' }], unavailable: [] });
    expect(late.resolve).toHaveBeenCalledTimes(1);
  });

  it('never calls a product with no valid key', async () => {
    const p = provider();
    expect(await resolveCounterparts(TENANT, READER, 'THREAT', ['apt28'], [p])).toEqual({ counterparts: [], unavailable: [] });
    expect(p.resolve).not.toHaveBeenCalled();
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

  it('asks OpenCTI on the connection\'s address but links to the object on the URL OpenCTI names itself', async () => {
    const fetchImpl = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response(JSON.stringify({ data: { stixCoreObjects: { edges: [
      { node: { id: 'abc', standard_id: STIX, entity_type: 'Intrusion-Set', representative: { main: 'APT28' } } },
    ] } } }))));
    const connection = { url: 'http://opencti:8080/', token: 'connector-token' };
    const publicUrl = vi.fn((_connection: unknown) => Promise.resolve('https://opencti.example.com/'));
    const p = openctiProvider(connection, () => Promise.resolve('reader-jwt'), fetchImpl, publicUrl);

    const found = await p.resolve('THREAT', [STIX]);

    expect(fetchImpl.mock.calls[0][0]).toBe('http://opencti:8080/graphql');
    expect(publicUrl).toHaveBeenCalledWith(connection);
    expect(found[0]?.objectUrl).toBe('https://opencti.example.com/dashboard/id/abc');
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
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => Promise.resolve(new Response(String(init.body).includes('stixCoreObjects') ? '{"data":{"stixCoreObjects":{"edges":[]}}}' : '[]')));
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

describe('a lookup that answers with something other than its documented shape', () => {
  const CONNECTION = { url: 'https://product.example', token: 'connector-token' };
  const SIGN = () => Promise.resolve('reader-jwt');
  const CVE = 'CVE-2024-3400';
  const OPENCTI_EMPTY = { data: { stixCoreObjects: { edges: [] } } };
  const OPENCTI_REFUSED = { errors: [{ message: 'No user reader@example.com', extensions: { code: 'AUTH_REQUIRED' } }], data: null };
  const answeringWith = (body: unknown) => vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));

  beforeEach(() => resetCounterpartCache());

  it('should find nothing, without failing, when OpenCTI answers an empty page', async () => {
    const opencti = openctiProvider(CONNECTION, SIGN, answeringWith(OPENCTI_EMPTY));

    expect(await opencti.resolve('VULNERABILITY', [CVE])).toEqual([]);
  });

  it('should fail when OpenCTI refuses the query with a 200, whatever the error says', async () => {
    const opencti = openctiProvider(CONNECTION, SIGN, answeringWith(OPENCTI_REFUSED));

    await expect(opencti.resolve('VULNERABILITY', [CVE])).rejects.toThrow('XTM counterpart lookup failed');
  });

  it('should fail when OpenCTI answers a page that is not a connection', async () => {
    await expect(openctiProvider(CONNECTION, SIGN, answeringWith({ data: { stixCoreObjects: null } })).resolve('VULNERABILITY', [CVE])).rejects.toThrow();
    await expect(openctiProvider(CONNECTION, SIGN, answeringWith({ data: { stixCoreObjects: { edges: 'none' } } })).resolve('VULNERABILITY', [CVE])).rejects.toThrow();
    await expect(openctiProvider(CONNECTION, SIGN, answeringWith('<html>Sign in</html>')).resolve('VULNERABILITY', [CVE])).rejects.toThrow();
  });

  it('should find nothing, without failing, when OpenAEV answers an empty list, and fail on anything else', async () => {
    expect(await openaevProvider(CONNECTION, SIGN, answeringWith([])).resolve('VULNERABILITY', [CVE])).toEqual([]);
    await expect(openaevProvider(CONNECTION, SIGN, answeringWith({ error: 'Forbidden' })).resolve('VULNERABILITY', [CVE])).rejects.toThrow('XTM counterpart lookup failed');
  });

  it('should find nothing, without failing, when XTM One answers an empty inventory, and fail on anything else', async () => {
    const headers = () => Promise.resolve({ Authorization: 'Bearer reader-jwt' });

    expect(await xtmOneProvider('https://xtm-one.example', headers, answeringWith({ items: [] })).resolve('ASSET', ['web-01'])).toEqual([]);
    await expect(xtmOneProvider('https://xtm-one.example', headers, answeringWith({ detail: 'Forbidden' })).resolve('ASSET', ['web-01'])).rejects.toThrow('XTM counterpart lookup failed');
  });

  it('should carry no text of the upstream answer in the failure', async () => {
    const failure = await openctiProvider(CONNECTION, SIGN, answeringWith(OPENCTI_REFUSED)).resolve('VULNERABILITY', [CVE]).catch((err: unknown) => err);

    expect(JSON.stringify(failure instanceof Error ? { message: failure.message, data: 'data' in failure ? failure.data : undefined } : failure)).not.toContain('reader@example.com');
  });

  it('should name the product as unavailable, and not cache the failure as a miss', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(OPENCTI_REFUSED), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(OPENCTI_EMPTY), { status: 200 }));
    const opencti = openctiProvider(CONNECTION, SIGN, fetchImpl);

    expect(await resolveCounterparts('t-1', 'u-1', 'VULNERABILITY', [CVE], [opencti])).toEqual({ counterparts: [], unavailable: ['opencti'] });
    expect(await resolveCounterparts('t-1', 'u-1', 'VULNERABILITY', [CVE], [opencti])).toEqual({ counterparts: [], unavailable: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
