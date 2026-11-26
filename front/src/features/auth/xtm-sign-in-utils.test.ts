import { describe, expect, it } from 'vitest';
import { renewsSessionNow, signInPage, xtmSignInHref } from './xtm-sign-in-utils';

describe('xtmSignInHref', () => {
  it('points at the sign-in route', () => {
    expect(xtmSignInHref()).toBe('/api/auth/xtm/login');
  });

  it('carries the page to land on, encoded', () => {
    expect(xtmSignInHref('http://localhost:3000/risks?tab=open&x=1'))
      .toBe('/api/auth/xtm/login?redirect=http%3A%2F%2Flocalhost%3A3000%2Frisks%3Ftab%3Dopen%26x%3D1');
  });
});

describe('signInPage', () => {
  const ready = { available: true, sessionEnded: false };

  it('offers to sign in with XTM One on a first visit or after a sign-out', () => {
    expect(signInPage(ready)).toBe('sign-in');
  });

  it('goes straight back through XTM One when a session of this browser ended', () => {
    expect(signInPage({ ...ready, sessionEnded: true })).toBe('redirect');
  });

  it('says why the last attempt did not go through rather than going round again', () => {
    expect(signInPage({ ...ready, sessionEnded: true, error: 'failed' })).toBe('refused');
    expect(signInPage({ ...ready, sessionEnded: true, available: false })).toBe('unavailable');
  });

  it('says XTM One is unavailable when it cannot, or when the last attempt found it so', () => {
    expect(signInPage({ ...ready, available: false })).toBe('unavailable');
    expect(signInPage({ ...ready, error: 'unavailable' })).toBe('unavailable');
  });

  it('says why the last attempt did not go through', () => {
    expect(signInPage({ ...ready, error: 'conflict' })).toBe('refused');
  });
});

describe('renewsSessionNow', () => {
  const now = Date.parse('2026-11-07T10:00:00Z');
  const endingIn = (minutes: number) => new Date(now + minutes * 60_000).toISOString();

  it('renews a session XTM One renews once it ends within the window', () => {
    expect(renewsSessionNow({ sessionExpiresAt: endingIn(9), renewsThroughXtmOne: true }, now)).toBe(true);
    expect(renewsSessionNow({ sessionExpiresAt: endingIn(-1), renewsThroughXtmOne: true }, now)).toBe(true);
  });

  it('leaves a session with time left', () => {
    expect(renewsSessionNow({ sessionExpiresAt: endingIn(11), renewsThroughXtmOne: true }, now)).toBe(false);
  });

  it('never renews through XTM One an account it does not know, nor a session with no end', () => {
    expect(renewsSessionNow({ sessionExpiresAt: endingIn(1), renewsThroughXtmOne: false }, now)).toBe(false);
    expect(renewsSessionNow({ sessionExpiresAt: null, renewsThroughXtmOne: true }, now)).toBe(false);
  });
});
