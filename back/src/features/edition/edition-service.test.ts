import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The relay reaches the logger, which parses the process config at import time.
const publishRemoteEntitlement = vi.fn();
vi.mock('./entitlement-ipc', () => ({
  publishRemoteEntitlement: (...args: Array<unknown>) => publishRemoteEntitlement(...args),
}));

const { grantRemoteEntitlement } = await import('./edition-service');
const {
  beginEditionResolution,
  ENTERPRISE_LICENSE_VALIDITY_MS,
  getEnterpriseEditionEnd,
  getLicenseExpiry,
  getLicenseType,
  isEditionResolutionPending,
  isEnterpriseEdition,
  resetEditionState,
} = await import('./edition-state');

const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
const ONE_YEAR = 365 * 24 * 60 * 60_000;
const LICENSE_EXPIRY = NOW + ONE_YEAR - 90 * 24 * 60 * 60_000;

describe('recording the remote entitlement', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    resetEditionState();
    vi.useRealTimers();
  });

  it('ends the grant when the proof lapses, before the validity window does', () => {
    grantRemoteEntitlement(NOW + 60_000, NOW, 'trial');

    vi.advanceTimersByTime(59_999);
    expect(isEnterpriseEdition()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isEnterpriseEdition()).toBe(false);
    expect(publishRemoteEntitlement).toHaveBeenCalledWith({ expiresAt: NOW + 60_000, licenseExpiresAt: NOW, licenseType: 'trial' });
  });

  it('ends it after the validity window when the proof lasts longer, so an outage still fails closed', () => {
    grantRemoteEntitlement(NOW + ONE_YEAR, LICENSE_EXPIRY, 'standard');

    expect(publishRemoteEntitlement).toHaveBeenCalledWith({ expiresAt: NOW + ENTERPRISE_LICENSE_VALIDITY_MS, licenseExpiresAt: LICENSE_EXPIRY, licenseType: 'standard' });
    vi.advanceTimersByTime(ENTERPRISE_LICENSE_VALIDITY_MS - 1);
    expect(isEnterpriseEdition()).toBe(true);
    expect(getEnterpriseEditionEnd()).toBe(NOW + ENTERPRISE_LICENSE_VALIDITY_MS);
    vi.advanceTimersByTime(1);
    expect(isEnterpriseEdition()).toBe(false);
    expect(getEnterpriseEditionEnd()).toBeNull();
  });

  it('keeps the license\'s own expiry and type beside the grant, whatever the window', () => {
    grantRemoteEntitlement(NOW + ONE_YEAR, LICENSE_EXPIRY, 'nfr');

    expect(getLicenseExpiry()).toBe(LICENSE_EXPIRY);
    expect(getLicenseType()).toBe('nfr');
    vi.advanceTimersByTime(ENTERPRISE_LICENSE_VALIDITY_MS);
    expect(getLicenseExpiry()).toBeNull();
    expect(getLicenseType()).toBeNull();
  });

  it.each([
    ['proves nothing', 0],
    ['proves a grant that has already lapsed', NOW],
  ])('revokes it at once when the answer %s, license date included', (_label, entitledUntil) => {
    grantRemoteEntitlement(NOW + ONE_YEAR, LICENSE_EXPIRY, 'standard');
    grantRemoteEntitlement(entitledUntil, LICENSE_EXPIRY, 'standard');

    expect(isEnterpriseEdition()).toBe(false);
    expect(getEnterpriseEditionEnd()).toBeNull();
    expect(getLicenseExpiry()).toBeNull();
    expect(getLicenseType()).toBeNull();
    expect(publishRemoteEntitlement).toHaveBeenLastCalledWith({ expiresAt: 0, licenseExpiresAt: null, licenseType: null });
  });

  it('settles the edition, a refusal being a decision too', () => {
    beginEditionResolution();

    grantRemoteEntitlement(0, null, null);

    expect(isEditionResolutionPending()).toBe(false);
  });
});
