import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginEditionResolution,
  getEdition,
  getEditionLicenseSource,
  getEnterpriseEditionEnd,
  getLicenseExpiry,
  isEnterpriseEdition,
  markEditionResolved,
  resetEditionState,
  setLocalEntitlementExpiry,
  setRemoteEntitlementExpiry,
  whenEditionResolved,
} from './edition-state';

/** An arbitrary window long enough to outlast this file's assertions. */
const REMOTE_TTL_MS = 10 * 60_000;
const grantRemote = (ttlMs = REMOTE_TTL_MS) => setRemoteEntitlementExpiry(Date.now() + ttlMs);

describe('enterprise edition entitlement', () => {
  afterEach(() => {
    resetEditionState();
    vi.useRealTimers();
  });

  it('fails closed by default (Community Edition until XTM One says otherwise)', () => {
    expect(isEnterpriseEdition()).toBe(false);
    expect(getEdition()).toBe('ce');
  });

  it('is entitled by the remote grant', () => {
    grantRemote();
    expect(isEnterpriseEdition()).toBe(true);
    expect(getEdition()).toBe('ee');
  });

  it('expires the grant when refreshes stop (fail closed on outage)', () => {
    vi.useFakeTimers();
    grantRemote();

    // A refresh within the TTL renews it.
    vi.advanceTimersByTime(REMOTE_TTL_MS - 1);
    expect(isEnterpriseEdition()).toBe(true);
    grantRemote();

    // Refreshes keep failing: the last known "entitled" must not stay alive.
    vi.advanceTimersByTime(REMOTE_TTL_MS);
    expect(isEnterpriseEdition()).toBe(false);
  });

  it('revokes the grant immediately when the refresh says so', () => {
    grantRemote();
    setRemoteEntitlementExpiry(0);
    expect(isEnterpriseEdition()).toBe(false);
  });

  it('reports the end of the grant and the license expiry only while the grant holds', () => {
    expect(getEnterpriseEditionEnd()).toBeNull();
    expect(getLicenseExpiry()).toBeNull();

    const expiresAt = Date.now() + REMOTE_TTL_MS;
    const licenseExpiresAt = Date.now() + 30 * REMOTE_TTL_MS;
    setRemoteEntitlementExpiry(expiresAt, licenseExpiresAt);
    expect(getEnterpriseEditionEnd()).toBe(expiresAt);
    expect(getLicenseExpiry()).toBe(licenseExpiresAt);

    setRemoteEntitlementExpiry(0);
    expect(getEnterpriseEditionEnd()).toBeNull();
    expect(getLicenseExpiry()).toBeNull();
  });

  it('settles immediately in a process nothing will grant to', async () => {
    // A process that never expects an answer must not hang every gate.
    await expect(whenEditionResolved()).resolves.toBeUndefined();
  });

  it('holds a gate open until the first resolution lands', async () => {
    beginEditionResolution();
    let settled = false;
    const waiting = whenEditionResolved().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    markEditionResolved();
    await waiting;
    expect(settled).toBe(true);
  });

  describe('with an installed Filigran license (the local slot)', () => {
    it('is entitled by the local grant alone', () => {
      const now = Date.now();
      const licenseEnd = now + 2 * REMOTE_TTL_MS;
      setLocalEntitlementExpiry(now + REMOTE_TTL_MS, licenseEnd);
      expect(isEnterpriseEdition()).toBe(true);
      expect(getEditionLicenseSource()).toBe('local');
      expect(getLicenseExpiry()).toBe(licenseEnd);
    });

    it('reports XTM One\'s grant first when both entitle, and the later end', () => {
      const remoteEnd = Date.now() + REMOTE_TTL_MS;
      const localEnd = Date.now() + 3 * REMOTE_TTL_MS;
      setRemoteEntitlementExpiry(remoteEnd, remoteEnd);
      setLocalEntitlementExpiry(localEnd, localEnd);
      expect(getEditionLicenseSource()).toBe('remote');
      expect(getLicenseExpiry()).toBe(remoteEnd);
      expect(getEnterpriseEditionEnd()).toBe(localEnd);
    });

    it('keeps the platform entitled when XTM One revokes its grant', () => {
      grantRemote();
      setLocalEntitlementExpiry(Date.now() + REMOTE_TTL_MS);
      setRemoteEntitlementExpiry(0);
      expect(isEnterpriseEdition()).toBe(true);
      expect(getEditionLicenseSource()).toBe('local');
    });

    it('falls back to Community Edition when neither slot entitles', () => {
      setLocalEntitlementExpiry(0);
      expect(getEditionLicenseSource()).toBeNull();
      expect(getEnterpriseEditionEnd()).toBeNull();
    });
  });
});
