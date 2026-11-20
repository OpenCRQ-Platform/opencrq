import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createXtmOneSeedDirectory, xtmOneSeedDirectoryFromConfig } from './xtm-one-seed-accounts';

const XTM_ONE = 'http://localhost:4105';
const ADMINISTRATOR = { email: 'xtm-admin@example.com', password: 'Xtm1-secret' };
const ALICE = { email: 'alice@example.com', fullName: 'Alice Martin', password: 'Admin1234!', role: 'user' as const };

const answer = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const fetchMock = vi.fn<typeof fetch>();

const calls = () => fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}`);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the platform seed\'s accounts in XTM One', () => {
  it('signs in once as the administrator and creates each user as a local account', async () => {
    fetchMock
      .mockResolvedValueOnce(answer({ access_token: 'admin-token' }))
      .mockResolvedValueOnce(answer({ id: 'xtm-alice' }, 201))
      .mockResolvedValueOnce(answer({ id: 'xtm-bob' }, 201));
    const accounts = createXtmOneSeedDirectory({ url: `${XTM_ONE}/`, ...ADMINISTRATOR }).provision;

    await expect(accounts(ALICE)).resolves.toBe('xtm-alice');
    await expect(accounts({ ...ALICE, email: 'bob@example.com' })).resolves.toBe('xtm-bob');

    expect(calls()).toEqual([
      `POST ${XTM_ONE}/api/v1/auth/login`,
      `POST ${XTM_ONE}/api/v1/users`,
      `POST ${XTM_ONE}/api/v1/users`,
    ]);
    const [, created] = fetchMock.mock.calls[1];
    expect(JSON.parse(String(created?.body))).toEqual({
      email: 'alice@example.com',
      full_name: 'Alice Martin',
      password: 'Admin1234!',
      role: 'user',
      account_type: 'local',
    });
    expect(new Headers(created?.headers).get('Authorization')).toBe('Bearer admin-token');
  });

  it('reuses the account already holding the email, whatever its case', async () => {
    fetchMock
      .mockResolvedValueOnce(answer({ access_token: 'admin-token' }))
      .mockResolvedValueOnce(answer({ detail: 'A user with this email already exists' }, 409))
      .mockResolvedValueOnce(answer([
        { id: 'xtm-admin', email: 'xtm-admin@example.com' },
        { id: 'xtm-alice', email: 'Alice@Example.com' },
      ]));

    await expect(createXtmOneSeedDirectory({ url: XTM_ONE, ...ADMINISTRATOR }).provision(ALICE)).resolves.toBe('xtm-alice');
    expect(calls()).toEqual([
      `POST ${XTM_ONE}/api/v1/auth/login`,
      `POST ${XTM_ONE}/api/v1/users`,
      `GET ${XTM_ONE}/api/v1/users`,
    ]);
  });

  it('sets the seed\'s password on the account it reuses when asked to', async () => {
    fetchMock
      .mockResolvedValueOnce(answer({ access_token: 'admin-token' }))
      .mockResolvedValueOnce(answer({ detail: 'A user with this email already exists' }, 409))
      .mockResolvedValueOnce(answer([{ id: 'xtm-alice', email: 'alice@example.com' }]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(createXtmOneSeedDirectory({ url: XTM_ONE, ...ADMINISTRATOR }, { resetPasswordOnReuse: true }).provision(ALICE)).resolves.toBe('xtm-alice');
    expect(calls()).toEqual([
      `POST ${XTM_ONE}/api/v1/auth/login`,
      `POST ${XTM_ONE}/api/v1/users`,
      `GET ${XTM_ONE}/api/v1/users`,
      `PUT ${XTM_ONE}/api/v1/users/xtm-alice/password`,
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({ new_password: 'Admin1234!' });
  });

  it('never resets the password of the administrator it signs in as', async () => {
    fetchMock
      .mockResolvedValueOnce(answer({ access_token: 'admin-token' }))
      .mockResolvedValueOnce(answer({ detail: 'A user with this email already exists' }, 409))
      .mockResolvedValueOnce(answer([{ id: 'xtm-admin', email: 'xtm-admin@example.com' }]));

    const directory = createXtmOneSeedDirectory({ url: XTM_ONE, ...ADMINISTRATOR }, { resetPasswordOnReuse: true });
    await expect(directory.provision({ ...ALICE, email: 'XTM-Admin@example.com' })).resolves.toBe('xtm-admin');
    expect(calls()).not.toContain(`PUT ${XTM_ONE}/api/v1/users/xtm-admin/password`);
  });

  it('lists the ids XTM One holds', async () => {
    fetchMock
      .mockResolvedValueOnce(answer({ access_token: 'admin-token' }))
      .mockResolvedValueOnce(answer([{ id: 'xtm-admin', email: 'xtm-admin@example.com' }, { id: 'xtm-alice', email: 'alice@example.com' }]));

    await expect(createXtmOneSeedDirectory({ url: XTM_ONE, ...ADMINISTRATOR }).knownIds()).resolves.toEqual(new Set(['xtm-admin', 'xtm-alice']));
  });

  it('fails with XTM One\'s reason when it refuses a user', async () => {
    fetchMock
      .mockResolvedValueOnce(answer({ access_token: 'admin-token' }))
      .mockResolvedValueOnce(answer({ detail: 'Password must contain at least one digit' }, 400));

    await expect(createXtmOneSeedDirectory({ url: XTM_ONE, ...ADMINISTRATOR }).provision(ALICE))
      .rejects.toThrow('Creating alice@example.com in XTM One failed, XTM One answered HTTP 400: Password must contain at least one digit');
  });

  it('never quotes a validation error, which echoes the password sent', async () => {
    fetchMock
      .mockResolvedValueOnce(answer({ access_token: 'admin-token' }))
      .mockResolvedValueOnce(answer({ detail: [{ msg: 'invalid', input: { password: 'Admin1234!' } }] }, 422));

    const failure = createXtmOneSeedDirectory({ url: XTM_ONE, ...ADMINISTRATOR }).provision(ALICE);
    await expect(failure).rejects.toThrow('XTM One answered HTTP 422');
    await expect(failure).rejects.not.toThrow('Admin1234!');
  });

  it('fails when the administrator cannot sign in', async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: 'Invalid credentials' }, 401));

    await expect(createXtmOneSeedDirectory({ url: XTM_ONE, ...ADMINISTRATOR }).provision(ALICE))
      .rejects.toThrow('Signing in to XTM One as xtm-admin@example.com failed, XTM One answered HTTP 401: Invalid credentials');
  });

  it('gives up on an XTM One that does not answer, saying so', async () => {
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));

    await expect(createXtmOneSeedDirectory({ url: XTM_ONE, ...ADMINISTRATOR }, { requestTimeoutMs: 10 }).knownIds())
      .rejects.toThrow(`XTM One at ${XTM_ONE} did not answer within 10 ms`);
  });

  it('waits a few seconds at most for each call by default', async () => {
    fetchMock.mockResolvedValueOnce(answer({ access_token: 'admin-token' })).mockResolvedValueOnce(answer([]));
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    await createXtmOneSeedDirectory({ url: XTM_ONE, ...ADMINISTRATOR }).knownIds();

    expect(timeout.mock.calls).toEqual([[5_000], [5_000]]);
    timeout.mockRestore();
  });

  it('leaves the users out of XTM One when no XTM One administrator is configured', () => {
    expect(xtmOneSeedDirectoryFromConfig({ url: XTM_ONE }, undefined)).toBeNull();
    expect(xtmOneSeedDirectoryFromConfig(undefined, undefined)).toBeNull();
  });

  it('fails the seed, not the configuration read, when the administrator has no XTM One to sign in to', async () => {
    const withoutXtmOne = xtmOneSeedDirectoryFromConfig(undefined, ADMINISTRATOR);

    await expect(withoutXtmOne?.provision(ALICE)).rejects.toThrow('no xtm_one block names one');
    await expect(withoutXtmOne?.knownIds()).rejects.toThrow('no xtm_one block names one');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
