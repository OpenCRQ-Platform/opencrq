import type { DrizzleDB } from '@app/module';
import type { JWTPayload } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyXtmOneJwt = vi.hoisted(() => vi.fn<() => Promise<JWTPayload | null>>());
const getUserByXtmSubject = vi.hoisted(() => vi.fn<(subject: string) => Promise<{ id: string } | null>>());

vi.mock('./xtm-one-config', () => ({
  getXtmOneSettings: () => ({ url: 'http://xtm-one:4000', token: 'registration-token', platformUrl: 'https://opencrq.example.com' }),
}));
vi.mock('./xtm-one-jwt', () => ({ verifyXtmOneJwt }));
vi.mock('@app/module', () => ({
  authService: {},
  createServices: () => ({ withOrigin: () => ({ auth: { getUserByXtmSubject } }) }),
}));

const { authenticateXtmOneJwt } = await import('./xtm-one-auth');

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- never reached: the services reading it are mocked
const db = {} as DrizzleDB;
const exp = Math.floor(Date.now() / 1000) + 600;

describe('authenticateXtmOneJwt', () => {
  beforeEach(() => {
    verifyXtmOneJwt.mockReset();
    getUserByXtmSubject.mockReset();
    getUserByXtmSubject.mockImplementation((subject) => Promise.resolve(subject === 'xtm-user-1' ? { id: 'u-1' } : null));
  });

  it('should resolve the account of the XTM One user the token names, whatever email it carries', async () => {
    verifyXtmOneJwt.mockResolvedValue({ sub: 'xtm-user-1', email: 'someone.else@example.com', exp });

    expect(await authenticateXtmOneJwt(db, 'a.b.c')).toEqual({ user: { id: 'u-1' }, expiresAt: new Date(exp * 1000) });
    expect(getUserByXtmSubject).toHaveBeenCalledWith('xtm-user-1');
  });

  it('should resolve no account for an XTM One user OpenCRQ does not know, even with a known email', async () => {
    verifyXtmOneJwt.mockResolvedValue({ sub: 'xtm-user-2', email: 'jane@example.com', exp });

    expect(await authenticateXtmOneJwt(db, 'a.b.c')).toBeNull();
  });

  it('should resolve nothing from a token that fails verification (bad signature, expired, other audience)', async () => {
    verifyXtmOneJwt.mockRejectedValue(new Error('signature verification failed'));

    expect(await authenticateXtmOneJwt(db, 'a.b.c')).toBeNull();
    expect(getUserByXtmSubject).not.toHaveBeenCalled();
  });

  it('should resolve nothing from a token another issuer signed', async () => {
    verifyXtmOneJwt.mockResolvedValue(null);

    expect(await authenticateXtmOneJwt(db, 'a.b.c')).toBeNull();
    expect(getUserByXtmSubject).not.toHaveBeenCalled();
  });

  it('should resolve nothing from a token naming no XTM One user', async () => {
    verifyXtmOneJwt.mockResolvedValue({ email: 'jane@example.com', exp });

    expect(await authenticateXtmOneJwt(db, 'a.b.c')).toBeNull();
    expect(getUserByXtmSubject).not.toHaveBeenCalled();
  });
});
