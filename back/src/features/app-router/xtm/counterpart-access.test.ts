import { describe, expect, it, vi } from 'vitest';
import { ReaderTokenUnavailable } from '../../xtm-one/xtm-one-token-exchange';
import { createCounterpartAccess, readCounterpartIssues } from './counterpart-access';

const CONNECTION = { url: 'https://opencti.example', token: 'connector-token' };

describe('createCounterpartAccess', () => {
  it('should ask once per tenant, member and product for a burst of reads', async () => {
    const refuse = vi.fn(() => Promise.reject(new ReaderTokenUnavailable('refused', 'user')));
    const access = createCounterpartAccess();

    const issues = await Promise.all([1, 2, 3].map(() => access.resolve('t-1', 'u-1', 'opencti', CONNECTION, refuse)));

    expect(issues).toEqual(['no_account', 'no_account', 'no_account']);
    expect(refuse).toHaveBeenCalledTimes(1);
  });

  it('should keep a failure for the window even though the token exchange does not', async () => {
    let clock = 0;
    const refuse = vi.fn(() => Promise.reject(new ReaderTokenUnavailable('HTTP 503')));
    const access = createCounterpartAccess(() => clock, 1_000);

    await access.resolve('t-1', 'u-1', 'opencti', CONNECTION, refuse);
    await access.resolve('t-1', 'u-1', 'opencti', CONNECTION, refuse);
    expect(refuse).toHaveBeenCalledTimes(1);

    clock = 1_001;
    await access.resolve('t-1', 'u-1', 'opencti', CONNECTION, refuse);
    expect(refuse).toHaveBeenCalledTimes(2);
  });

  it('should keep a separate answer per member and per product', async () => {
    const sign = vi.fn(() => Promise.resolve('reader-jwt'));
    const access = createCounterpartAccess();

    await access.resolve('t-1', 'u-1', 'opencti', CONNECTION, sign);
    await access.resolve('t-1', 'u-2', 'opencti', CONNECTION, sign);
    await access.resolve('t-1', 'u-1', 'openaev', CONNECTION, sign);

    expect(sign).toHaveBeenCalledTimes(3);
  });
});

describe('readCounterpartIssues', () => {
  const TENANT = 't-1';
  const SIGN = () => Promise.resolve('reader-jwt');
  const REFUSE = () => Promise.reject(new ReaderTokenUnavailable('refused', 'audience'));
  const connected = { opencti: { [TENANT]: CONNECTION }, openaev: { [TENANT]: { url: 'https://openaev.example', token: 'connector-token' } } };

  it('should say for each connected product why the person cannot be read there, or nothing', async () => {
    const access = { resolve: vi.fn((_tenant: string, _user: string, product: string) => Promise.resolve(product === 'opencti' ? 'not_linked' as const : null)) };

    expect(await readCounterpartIssues(access, { tenantId: TENANT, userId: 'u-1', connections: connected, authorization: SIGN }))
      .toEqual({ opencti: 'not_linked', openaev: null });
    expect(access.resolve).toHaveBeenCalledTimes(2);
  });

  it('should ask nothing for a service account, which never pivots', async () => {
    const access = { resolve: vi.fn() };

    expect(await readCounterpartIssues(access, { tenantId: TENANT, userId: undefined, connections: connected, authorization: REFUSE }))
      .toEqual({ opencti: null, openaev: null });
    expect(access.resolve).not.toHaveBeenCalled();
  });

  it('should ask nothing for a product the tenant has not connected, with no URL or no token, or connected for another tenant', async () => {
    const access = { resolve: vi.fn(() => Promise.resolve('unavailable' as const)) };
    const connections = {
      opencti: { [TENANT]: { url: '', token: 'connector-token' } },
      openaev: { 'other-tenant': { url: 'https://openaev.example', token: 'connector-token' } },
    };

    expect(await readCounterpartIssues(access, { tenantId: TENANT, userId: 'u-1', connections, authorization: SIGN }))
      .toEqual({ opencti: null, openaev: null });
    expect(await readCounterpartIssues(access, { tenantId: TENANT, userId: 'u-1', connections: undefined, authorization: SIGN }))
      .toEqual({ opencti: null, openaev: null });
    expect(access.resolve).not.toHaveBeenCalled();
  });
});
