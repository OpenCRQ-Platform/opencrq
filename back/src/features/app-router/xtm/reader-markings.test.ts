import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderAuthorization } from './xtm-providers';

const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));
// The logger parses the process config at import time.
vi.mock('../../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logWarn }),
}));

const { createReaderMarkingsResolver, parseAllowedMarkings, parseReaderScope, READER_MARKINGS_QUERY, withReaderScope } = await import('./reader-markings');
const { ReaderTokenUnavailable } = await import('../../xtm-one/xtm-one-token-exchange');

beforeEach(() => {
  logWarn.mockClear();
});

const CONNECTION = { url: 'https://opencti.example/', token: 'connector-token' };
const SIGN = () => Promise.resolve('reader-jwt');
const NO_SIGN = Object.assign(() => Promise.resolve(null), { unsigned: 'XTM One is not configured' });

const body = (markings: Array<string>) => ({
  data: {
    me: {
      id: 'octi-user',
      individual_id: 'octi-individual',
      allowed_marking: markings.map((standard_id) => ({ standard_id })),
      objectOrganization: { edges: [{ node: { id: 'org-b' } }, { node: { id: 'org-a' } }] },
      groups: { edges: [{ node: { id: 'group-1' } }] },
      capabilities: [{ name: 'KNOWLEDGE' }],
    },
    settings: { platform_organization: { id: 'org-platform' } },
  },
});
const answer = (markings: Array<string>) => new Response(JSON.stringify(body(markings)), { status: 200 });

const FRESH = 1_000;
const KEPT = 10_000;

const deferred = () => {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const markingsOf = (read: { scope: { markings: ReadonlyArray<string> } } | { issue: string } | undefined) =>
  (read && 'scope' in read ? read.scope.markings : undefined);

/** Lets a lookup started in the background run to its end. */
const settle = () => new Promise((done) => setTimeout(done, 0));

describe('parseAllowedMarkings', () => {
  it('should read the standard ids, deduplicated and sorted', () => {
    expect(parseAllowedMarkings({ data: { me: { allowed_marking: [{ standard_id: 'b' }, { standard_id: 'a' }, { standard_id: 'b' }] } } }))
      .toEqual(['a', 'b']);
  });

  it('should answer null on any other shape', () => {
    expect(parseAllowedMarkings({ errors: [{ message: 'forbidden' }] })).toBeNull();
    expect(parseAllowedMarkings({ data: { me: null } })).toBeNull();
  });
});

describe('parseReaderScope', () => {
  it('should read the markings and who the reader is in OpenCTI', () => {
    expect(parseReaderScope(body(['m-1']))).toEqual({
      markings: ['m-1'],
      access: {
        userId: 'octi-user',
        individualId: 'octi-individual',
        organizationIds: ['org-a', 'org-b'],
        groupIds: ['group-1'],
        bypass: false,
        platformOrganizationId: 'org-platform',
      },
    });
  });

  it('should read the BYPASS capability and a platform with no platform organization', () => {
    const bypass = body([]);
    bypass.data.me.capabilities = [{ name: 'BYPASS' }];
    const scope = parseReaderScope({ data: { ...bypass.data, settings: { platform_organization: null } } });

    expect(scope?.access.bypass).toBe(true);
    expect(scope?.access.platformOrganizationId).toBeNull();
  });

  it('should answer null when the identity is read in part', () => {
    const noSettings = { data: { me: body([]).data.me } };
    const noId = { data: { ...body([]).data, me: { ...body([]).data.me, id: undefined } } };

    expect(parseReaderScope(noSettings)).toBeNull();
    expect(parseReaderScope(noId)).toBeNull();
    expect(parseReaderScope({ errors: [{ message: 'forbidden' }] })).toBeNull();
  });
});

describe('withReaderScope', () => {
  const ORIGIN = { type: 'client', userId: 'u-1', tenantId: 't-1' } as const;
  const SCOPE = { markings: ['m-1'], access: { userId: 'octi-user', individualId: null, organizationIds: [], groupIds: [], bypass: false, platformOrganizationId: null } };

  it('should leave the origin and tell nothing when the tenant has no OpenCTI connection', () => {
    expect(withReaderScope(ORIGIN, undefined, 'per_member')).toEqual({ origin: ORIGIN, readerAccessIssue: null });
  });

  it('should narrow the origin by what OpenCTI answered, and tell nothing', () => {
    expect(withReaderScope(ORIGIN, { scope: SCOPE }, 'per_member')).toEqual({
      origin: { ...ORIGIN, markings: ['m-1'], openctiAccess: SCOPE.access },
      readerAccessIssue: null,
    });
  });

  it('should leave a reader OpenCTI did not answer for no clearance and tell why, in a tenant that reads per member', () => {
    expect(withReaderScope(ORIGIN, { issue: 'no_account' }, 'per_member')).toEqual({
      origin: { ...ORIGIN, markings: null, openctiAccess: null },
      readerAccessIssue: 'no_account',
    });
  });

  it('should name the connector, never the member, in a tenant that shows every member what the connector reads', () => {
    for (const issue of ['unavailable', 'no_account', 'not_linked'] as const) {
      expect(withReaderScope(ORIGIN, { issue }, 'service_account')).toEqual({
        origin: { ...ORIGIN, markings: null, openctiAccess: null },
        readerAccessIssue: 'connector_unavailable',
      });
    }
    expect(withReaderScope(ORIGIN, { scope: SCOPE }, 'service_account').readerAccessIssue).toBeNull();
  });
});

describe('createReaderMarkingsResolver', () => {
  it('should ask OpenCTI as the reader, never with the connector token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(answer(['m-1']));
    const resolver = createReaderMarkingsResolver(fetchImpl);
    const sign = vi.fn(SIGN);

    expect(await resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', sign)).toMatchObject({ scope: { markings: ['m-1'] } });
    expect(sign).toHaveBeenCalledWith('opencti', CONNECTION);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://opencti.example/graphql');
    expect(init.headers.Authorization).toBe('Bearer reader-jwt');
    expect(JSON.parse(init.body)).toEqual({ query: READER_MARKINGS_QUERY });
  });

  it('should not narrow a tenant with no OpenCTI connection', async () => {
    const unused = vi.fn();

    expect(await createReaderMarkingsResolver(unused).resolve('t-1', 'u-1', undefined, 'per_member', SIGN)).toBeUndefined();
    expect(unused).not.toHaveBeenCalled();
  });

  it('should fail closed without an identity, on a refusal or an error', async () => {
    const refused = createReaderMarkingsResolver(vi.fn().mockResolvedValue(new Response('no', { status: 401 })));
    const broken = createReaderMarkingsResolver(vi.fn().mockRejectedValue(new Error('timeout')));
    const unused = vi.fn();

    expect(await createReaderMarkingsResolver(unused).resolve('t-1', 'u-1', CONNECTION, 'per_member', NO_SIGN)).toEqual({ issue: 'unavailable' });
    expect(unused).not.toHaveBeenCalled();
    expect(await refused.resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN)).toEqual({ issue: 'unavailable' });
    expect(await broken.resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN)).toEqual({ issue: 'unavailable' });
  });

  it('should tell a reader whose OpenCTI is not linked, who has no account and who faces an outage apart', async () => {
    const issueOf = async (sign: ReaderAuthorization) =>
      createReaderMarkingsResolver(vi.fn().mockResolvedValue(answer([]))).resolve('t-1', 'u-1', CONNECTION, 'per_member', sign);
    const refused = (refusal: 'audience' | 'user' | null) => () => Promise.reject(new ReaderTokenUnavailable('XTM One refused the token exchange', refusal));

    expect(await issueOf(refused('audience'))).toEqual({ issue: 'not_linked' });
    expect(await issueOf(refused('user'))).toEqual({ issue: 'no_account' });
    expect(await issueOf(refused(null))).toEqual({ issue: 'unavailable' });
    expect(await issueOf(() => Promise.reject(new Error('signing key missing')))).toEqual({ issue: 'unavailable' });
    expect(await issueOf(() => Promise.resolve(null))).toEqual({ issue: 'unavailable' });
  });

  it('should call a token OpenCTI runs as nobody a missing account, and any other refusal an outage', async () => {
    const issueOf = async (error: Record<string, unknown>) => createReaderMarkingsResolver(
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ errors: [error], data: null }), { status: 200 })),
    ).resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN);

    expect(await issueOf({ message: 'You must be logged in to do this.', extensions: { code: 'AUTH_REQUIRED' } })).toEqual({ issue: 'no_account' });
    expect(await issueOf({ message: 'denied', extensions: { code: 'FORBIDDEN_ACCESS' } })).toEqual({ issue: 'unavailable' });
    expect(await issueOf({ message: 'boom' })).toEqual({ issue: 'unavailable' });
  });

  it('should keep the issue with the cached answer and never carry the failure text', async () => {
    const resolver = createReaderMarkingsResolver(vi.fn());
    const refuse = vi.fn(() => Promise.reject(new ReaderTokenUnavailable('XTM One refused: reader@example.com', 'user')));

    const first = await resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', refuse);
    const second = await resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', refuse);

    expect(refuse).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe('{"issue":"no_account"}');
  });

  it('should say why a reader has no scope, with the tenant and the user and never the token', async () => {
    const unresolved = (fetchImpl: () => Promise<Response>, sign: ReaderAuthorization = SIGN) =>
      createReaderMarkingsResolver(vi.fn(fetchImpl)).resolve('t-1', 'u-1', CONNECTION, 'per_member', sign);
    const refusal = (error: Record<string, unknown>) => new Response(JSON.stringify({ errors: [error], data: null }), { status: 200 });
    const networkError = new Error('connect failed for reader@example.com with Bearer leaked-token', { cause: { code: 'ECONNREFUSED' } });

    await unresolved(() => Promise.resolve(new Response('no', { status: 401 })));
    await unresolved(() => Promise.resolve(refusal({ message: 'No user reader@example.com', extensions: { code: 'AUTH_REQUIRED' } })));
    await unresolved(() => Promise.resolve(refusal({ message: 'reader@example.com', extensions: { code: 'reader@example.com' } })));
    await unresolved(() => Promise.resolve(new Response(JSON.stringify({ data: { me: null } }), { status: 200 })));
    await unresolved(() => Promise.resolve(new Response('<html>Sign in</html>', { status: 200 })));
    await unresolved(() => Promise.reject(networkError));
    await unresolved(() => Promise.reject(new DOMException('The operation timed out for reader@example.com', 'TimeoutError')));
    await unresolved(() => Promise.resolve(answer([])), NO_SIGN);
    await unresolved(() => Promise.resolve(answer([])), () => Promise.resolve(null));
    await unresolved(() => Promise.resolve(answer([])), () => Promise.reject(new ReaderTokenUnavailable('XTM One refused the token exchange: HTTP 403')));
    await unresolved(() => Promise.resolve(answer([])), () => Promise.reject(new ReaderTokenUnavailable('reading OpenCTI\'s public URL failed: HTTP 401')));
    await unresolved(() => Promise.resolve(answer([])), () => Promise.reject(new Error('XTM One signing key is missing for reader@example.com')));

    expect(logWarn.mock.calls.map(([, data]) => data.reason)).toEqual([
      'OpenCTI answered HTTP 401',
      'OpenCTI refused the query: AUTH_REQUIRED',
      'OpenCTI refused the query: no error code',
      'the answer lacks the reader scope fields',
      'OpenCTI answered something other than JSON',
      'the request failed: Error, ECONNREFUSED',
      'the request failed: TimeoutError',
      'no token could be signed for the reader: XTM One is not configured',
      'no token could be signed for the reader: no reason given',
      'XTM One refused the token exchange: HTTP 403',
      'reading OpenCTI\'s public URL failed: HTTP 401',
      'obtaining the reader\'s token failed: Error',
    ]);
    expect(logWarn.mock.calls.every(([message, data]) => message === 'OpenCTI reader scope unresolved'
      && data.tenantId === 't-1' && data.userId === 'u-1')).toBe(true);
    const logged = JSON.stringify(logWarn.mock.calls);
    expect(logged).not.toContain('reader-jwt');
    expect(logged).not.toContain('leaked-token');
    expect(logged).not.toContain('reader@example.com');
  });

  it('should ask OpenCTI once and log once for reads arriving together', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(new Response('no', { status: 500 })));
    const resolver = createReaderMarkingsResolver(fetchImpl);

    const scopes = await Promise.all([1, 2, 3].map(() => resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN)));

    expect(scopes).toEqual([{ issue: 'unavailable' }, { issue: 'unavailable' }, { issue: 'unavailable' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(logWarn).toHaveBeenCalledTimes(1);
  });

  it('should log nothing for a reader whose scope was read or a tenant with no OpenCTI', async () => {
    await createReaderMarkingsResolver(vi.fn().mockResolvedValue(answer(['m-1']))).resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN);
    await createReaderMarkingsResolver(vi.fn()).resolve('t-1', 'u-1', undefined, 'per_member', SIGN);

    expect(logWarn).not.toHaveBeenCalled();
  });

  it('should log a failure once per cache window, not on every read of the page', async () => {
    const resolver = createReaderMarkingsResolver(vi.fn().mockImplementation(() => Promise.resolve(new Response('no', { status: 500 }))));

    await resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN);
    await resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN);

    expect(logWarn).toHaveBeenCalledTimes(1);
  });

  it('should count the fresh window from the answer, not from the request', async () => {
    let clock = 0;
    const fetchImpl = vi.fn().mockImplementation(() => {
      clock += 500;
      return Promise.resolve(answer(['m-1']));
    });
    const resolver = createReaderMarkingsResolver(fetchImpl, () => clock, { freshMs: FRESH, keptMs: KEPT });

    await resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN);
    clock = 1_400;
    await resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('should keep a scope per tenant and user', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(answer(['m-1'])));
    const resolver = createReaderMarkingsResolver(fetchImpl);

    await resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN);
    await resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await resolver.resolve('t-1', 'u-2', CONNECTION, 'per_member', SIGN);
    await resolver.resolve('t-2', 'u-1', CONNECTION, 'per_member', SIGN);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('should not ask OpenCTI while the scope is fresh', async () => {
    let clock = 0;
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(answer(['m-1'])));
    const resolver = createReaderMarkingsResolver(fetchImpl, () => clock, { freshMs: FRESH, keptMs: KEPT });

    await resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN);
    clock = FRESH - 1;
    await resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN);
    await settle();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('should answer a stale scope at once and refresh it in the background, once for a burst of reads', async () => {
    let clock = 0;
    const later = deferred();
    const fetchImpl = vi.fn().mockResolvedValueOnce(answer(['m-1'])).mockReturnValueOnce(later.promise);
    const resolver = createReaderMarkingsResolver(fetchImpl, () => clock, { freshMs: FRESH, keptMs: KEPT });
    const read = () => resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN);

    await read();
    clock = FRESH + 1;
    const burst = await Promise.all([read(), read(), read()]);

    expect(burst.map(markingsOf)).toEqual([['m-1'], ['m-1'], ['m-1']]);
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    later.resolve(answer(['m-2']));
    await settle();
    expect(markingsOf(await read())).toEqual(['m-2']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('should keep the last known scope when a refresh fails, and ask again only once it is stale again', async () => {
    let clock = 0;
    const fetchImpl = vi.fn().mockResolvedValueOnce(answer(['m-1'])).mockImplementation(() => Promise.resolve(new Response('no', { status: 503 })));
    const resolver = createReaderMarkingsResolver(fetchImpl, () => clock, { freshMs: FRESH, keptMs: KEPT });
    const read = () => resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN);

    await read();
    clock = FRESH + 1;
    await read();
    await settle();

    expect(markingsOf(await read())).toEqual(['m-1']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(logWarn).toHaveBeenCalledTimes(1);

    clock = 2 * FRESH + 2;
    await read();
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('should replace the last known scope at once when a refresh says the reader has no account or OpenCTI is not linked', async () => {
    const refusals: Array<[string, () => Promise<Response>, ReaderAuthorization]> = [
      ['no_account', () => Promise.resolve(new Response(JSON.stringify({ errors: [{ message: 'You must be logged in to do this.', extensions: { code: 'AUTH_REQUIRED' } }], data: null }), { status: 200 })), SIGN],
      ['not_linked', () => Promise.resolve(answer(['m-1'])), vi.fn()
        .mockResolvedValueOnce('reader-jwt')
        .mockRejectedValue(new ReaderTokenUnavailable('XTM One refused the token exchange', 'audience'))],
    ];
    for (const [issue, refusal, sign] of refusals) {
      let clock = 0;
      const fetchImpl = vi.fn().mockResolvedValueOnce(answer(['m-1'])).mockImplementation(refusal);
      const resolver = createReaderMarkingsResolver(fetchImpl, () => clock, { freshMs: FRESH, keptMs: KEPT });
      const read = () => resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', sign);

      await read();
      clock = FRESH + 1;
      expect(markingsOf(await read())).toEqual(['m-1']);
      await settle();

      expect(await read()).toEqual({ issue });
    }
  });

  it('should wait for OpenCTI again once the scope was not confirmed for the kept window, failed refreshes included', async () => {
    let clock = 0;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(answer(['m-1']))
      .mockResolvedValueOnce(new Response('no', { status: 503 }))
      .mockResolvedValueOnce(answer(['m-2']));
    const resolver = createReaderMarkingsResolver(fetchImpl, () => clock, { freshMs: FRESH, keptMs: KEPT });
    const read = () => resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN);

    await read();
    clock = KEPT - 1;
    expect(markingsOf(await read())).toEqual(['m-1']);
    await settle();

    clock = KEPT + 1;
    expect(markingsOf(await read())).toEqual(['m-2']);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('should keep a first failure as a known fail-closed answer, refreshed in the background like a scope', async () => {
    let clock = 0;
    const later = deferred();
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('no', { status: 503 })).mockReturnValueOnce(later.promise);
    const resolver = createReaderMarkingsResolver(fetchImpl, () => clock, { freshMs: FRESH, keptMs: KEPT });
    const read = () => resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN);

    expect(await read()).toEqual({ issue: 'unavailable' });
    clock = FRESH + 1;
    expect(await read()).toEqual({ issue: 'unavailable' });
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    later.resolve(answer(['m-1']));
    await settle();
    expect(markingsOf(await read())).toEqual(['m-1']);
  });

  it('should answer fail closed past the first wait, and serve the scope once the lookup settles', async () => {
    const later = deferred();
    const fetchImpl = vi.fn().mockReturnValueOnce(later.promise);
    const resolver = createReaderMarkingsResolver(fetchImpl, Date.now, { firstWaitMs: 10 });
    const read = () => resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN);

    expect(await read()).toEqual({ issue: 'unavailable' });
    expect(await read()).toEqual({ issue: 'unavailable' });

    later.resolve(answer(['m-1']));
    await settle();
    expect(markingsOf(await read())).toEqual(['m-1']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('should evict the reader confirmed the longest ago when full, not every reader', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(answer(['m-1'])));
    const resolver = createReaderMarkingsResolver(fetchImpl, Date.now, { capacity: 2 });
    const read = (userId: string) => resolver.resolve('t-1', userId, CONNECTION, 'per_member', SIGN);

    await read('u-1');
    await read('u-2');
    await read('u-3');
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    await read('u-2');
    await read('u-3');
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    await read('u-1');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('should evict the reader whose answer is the oldest, a refreshed answer counting from its refresh', async () => {
    let clock = 0;
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(answer(['m-1'])));
    const resolver = createReaderMarkingsResolver(fetchImpl, () => clock, { freshMs: FRESH, keptMs: KEPT, capacity: 2 });
    const read = (userId: string) => resolver.resolve('t-1', userId, CONNECTION, 'per_member', SIGN);

    await read('u-1');
    await read('u-2');
    clock = FRESH + 1;
    await read('u-1');
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    await read('u-3');
    await read('u-1');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    await read('u-2');
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('should not bring back a reader evicted while their lookup ran', async () => {
    const later = deferred();
    const fetchImpl = vi.fn().mockReturnValueOnce(later.promise).mockImplementation(() => Promise.resolve(answer(['m-1'])));
    const resolver = createReaderMarkingsResolver(fetchImpl, Date.now, { firstWaitMs: 10, capacity: 1 });
    const read = (userId: string) => resolver.resolve('t-1', userId, CONNECTION, 'per_member', SIGN);

    await read('u-1');
    await read('u-2');
    later.resolve(answer(['m-1']));
    await settle();

    await read('u-1');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('should place an expired reader asked again last, not where their old answer was', async () => {
    let clock = 0;
    const later = deferred();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(answer(['m-1']))
      .mockResolvedValueOnce(answer(['m-1']))
      .mockResolvedValueOnce(answer(['m-1']))
      .mockReturnValueOnce(later.promise)
      .mockImplementation(() => Promise.resolve(answer(['m-1'])));
    const resolver = createReaderMarkingsResolver(fetchImpl, () => clock, { freshMs: FRESH, keptMs: KEPT, firstWaitMs: 10, capacity: 3 });
    const read = (userId: string) => resolver.resolve('t-1', userId, CONNECTION, 'per_member', SIGN);

    await read('u-1');
    clock = 1;
    await read('u-2');
    clock = KEPT / 2;
    await read('u-3');
    clock = KEPT + 2;
    await read('u-2');
    await read('u-4');
    await read('u-5');
    later.resolve(answer(['m-1']));
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(6);

    await read('u-2');
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('should ask again once a refresh stuck past a fresh window, rather than wait on it for good', async () => {
    let clock = 0;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(answer(['m-1']))
      .mockReturnValueOnce(new Promise<Response>(() => undefined))
      .mockResolvedValueOnce(answer(['m-2']));
    const resolver = createReaderMarkingsResolver(fetchImpl, () => clock, { freshMs: FRESH, keptMs: KEPT });
    const read = () => resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN);

    await read();
    clock = FRESH + 1;
    await read();
    clock = 2 * FRESH;
    await read();
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    clock = 2 * FRESH + 1;
    expect(markingsOf(await read())).toEqual(['m-1']);
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(markingsOf(await read())).toEqual(['m-2']);
  });

  it('should ask again once the tenant changed its threat visibility, with the bearer that choice names', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(answer(['m-1'])));
    const resolver = createReaderMarkingsResolver(fetchImpl);
    const connectorToken = vi.fn().mockResolvedValue('connector-token');

    await resolver.resolve('t-1', 'u-1', CONNECTION, 'per_member', SIGN);
    await resolver.resolve('t-1', 'u-1', CONNECTION, 'service_account', connectorToken);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(connectorToken).toHaveBeenCalledTimes(1);
  });
});
