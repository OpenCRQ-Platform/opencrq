import { describe, expect, it } from 'vitest';
import type { LicenseCardInput } from './filigran-license-utils';
import { installedLicenseRefusal, licenseMessage, shownLicense, xtmOneLicenseSettingsUrl } from './filigran-license-utils';

const EXPIRY = new Date('2027-11-06T00:00:00.000Z');

const input = (overrides: Partial<LicenseCardInput> = {}): LicenseCardInput => ({
  isEnterpriseEdition: false,
  xtmOneConfigured: true,
  registration: 'ok',
  entitlementRefusal: null,
  status: { licenseType: null, licenseExpiresAt: null, licenseSource: null },
  installed: undefined,
  ...overrides,
});

describe('shownLicense', () => {
  it('should show the license XTM One distributes for Enterprise Edition granted by it', () => {
    const shown = shownLicense(input({
      isEnterpriseEdition: true,
      status: { licenseType: 'nfr', licenseExpiresAt: EXPIRY, licenseSource: 'remote' },
    }));

    expect(shown).toEqual({ type: 'nfr', expiresAt: EXPIRY, source: 'remote' });
  });

  it('should show an entitling license installed here, whatever XTM One grants', () => {
    const shown = shownLicense(input({
      isEnterpriseEdition: true,
      status: { licenseType: 'nfr', licenseExpiresAt: EXPIRY, licenseSource: 'remote' },
      installed: { entitled: true, reason: null, expiresAt: EXPIRY, type: 'standard' },
    }));

    expect(shown).toEqual({ type: 'standard', expiresAt: EXPIRY, source: 'local' });
  });

  it('should show no license in Community Edition', () => {
    expect(shownLicense(input())).toBeNull();
  });
});

describe('licenseMessage', () => {
  it('should send a connected Community instance to XTM One to install the license', () => {
    expect(licenseMessage(input())).toEqual({ kind: 'install-in-xtm-one' });
  });

  it('should carry XTM One\'s refusal rather than the install invitation', () => {
    expect(licenseMessage(input({ entitlementRefusal: 'license_withheld_default_token' })))
      .toEqual({ kind: 'refusal', refusal: 'license_withheld_default_token' });
  });

  it.each(['unreachable', 'unreadable', 'refused'] as const)('should report an XTM One %s registration as an outage, in either edition', (registration) => {
    expect(licenseMessage(input({ registration }))).toEqual({ kind: 'xtm-one-outage' });
    expect(licenseMessage(input({ registration, isEnterpriseEdition: true }))).toEqual({ kind: 'xtm-one-outage' });
  });

  it('should say nothing for Enterprise Edition from a reachable XTM One, even with a stale refusal', () => {
    expect(licenseMessage(input({ isEnterpriseEdition: true, entitlementRefusal: 'license_invalid' }))).toBeNull();
  });

  it('should say nothing without XTM One, where the card speaks itself', () => {
    expect(licenseMessage(input({ xtmOneConfigured: false }))).toBeNull();
  });

  it('should say nothing while XTM One has not answered yet', () => {
    expect(licenseMessage(input({ registration: 'pending' }))).toBeNull();
  });

  it('should still send a connected Community instance to XTM One when the license installed here does not entitle', () => {
    expect(licenseMessage(input({
      installed: { entitled: false, reason: 'it expired', expiresAt: null, type: null },
    }))).toEqual({ kind: 'install-in-xtm-one' });
  });
});

describe('installedLicenseRefusal', () => {
  it('should give why the license installed here does not entitle', () => {
    expect(installedLicenseRefusal(input({
      installed: { entitled: false, reason: 'it expired', expiresAt: null, type: null },
    }))).toBe('it expired');
  });

  it('should give nothing for an entitling license, none installed, or a user who cannot read it', () => {
    expect(installedLicenseRefusal(input({ installed: { entitled: true, reason: null, expiresAt: EXPIRY, type: 'standard' } }))).toBeNull();
    expect(installedLicenseRefusal(input({ installed: null }))).toBeNull();
    expect(installedLicenseRefusal(input())).toBeNull();
  });
});

describe('xtmOneLicenseSettingsUrl', () => {
  it('should open XTM One on its platform settings', () => {
    expect(xtmOneLicenseSettingsUrl('https://xtm-one.example.com')).toBe('https://xtm-one.example.com/settings/platform');
  });
});
