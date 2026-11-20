/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EditionCardState } from './edition-cards-test-harness';
import { inDays, renderEditionCard, XTM_ONE_URL } from './edition-cards-test-harness';
import { FiligranLicenseCard } from './filigran-license-card';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderCard = (state: EditionCardState = {}) => renderEditionCard(FiligranLicenseCard, state);

describe('FiligranLicenseCard', () => {
  it('should show the type, validity and source of the license XTM One distributes, with no paste form', async () => {
    renderCard({ edition: 'ee', licenseType: 'nfr', licenseExpiresAt: inDays(6), canManagePlatform: true });

    expect(await screen.findByText('NFR (not for resale)')).toBeDefined();
    expect(await screen.findByText(/6 days left/)).toBeDefined();
    expect(screen.getByText('Distributed by XTM One')).toBeDefined();
    expect(screen.queryByText('Filigran license certificate (PEM)')).toBeNull();
  });

  it('should send a connected Community instance to XTM One\'s platform settings, in a new tab', async () => {
    renderCard({ edition: 'ce', canManagePlatform: true });

    expect(await screen.findByText('Install the Filigran license in XTM One to switch this instance to Enterprise Edition.')).toBeDefined();
    const link = screen.getByRole('link', { name: /Install the license in XTM One/ });
    expect(link.getAttribute('href')).toBe(`${XTM_ONE_URL}/settings/platform`);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.queryByText('Filigran license certificate (PEM)')).toBeNull();
  });

  it('should explain the default token refusal in plain words', async () => {
    renderCard({ entitlementRefusal: 'license_withheld_default_token' });

    expect(await screen.findByText('XTM One does not pass on the Filigran license')).toBeDefined();
    expect(screen.getByText(/still the one shipped with the installation/)).toBeDefined();
    expect(screen.queryByRole('link', { name: /Install the license in XTM One/ })).toBeNull();
  });

  it('should say a Community instance loses license activation while XTM One fails', async () => {
    renderCard({ registration: 'unreachable', canManagePlatform: true });

    expect(await screen.findByText('Ask Ariane and license activation are unavailable.')).toBeDefined();
    expect(screen.queryByText('Filigran license certificate (PEM)')).toBeNull();
  });

  it('should tell an instance entitled by XTM One that Enterprise Edition is no longer extended while it fails', async () => {
    renderCard({ edition: 'ee', registration: 'unreachable', endsAt: inDays(3) });

    expect(await screen.findByText(/^Ask Ariane is unavailable and Enterprise Edition is no longer extended: it ends on .*, or at the next restart\.$/)).toBeDefined();
  });

  it('should list a license installed here with "Remove", though XTM One is configured', async () => {
    renderCard({
      edition: 'ee',
      licenseSource: 'local',
      canManagePlatform: true,
      installedLicense: { entitled: true, reason: null, expiresAt: inDays(300), type: 'standard' },
    });

    expect(await screen.findByText('Installed on this instance')).toBeDefined();
    expect(await screen.findByText('Standard')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDefined();
    expect(screen.queryByText('Filigran license certificate (PEM)')).toBeNull();
  });

  it('should not announce the end of Enterprise Edition at a restart while a license installed here entitles', async () => {
    renderCard({
      edition: 'ee',
      registration: 'unreachable',
      endsAt: inDays(3),
      licenseSource: 'remote',
      canManagePlatform: true,
      installedLicense: { entitled: true, reason: null, expiresAt: inDays(300), type: 'standard' },
    });

    expect(await screen.findByText('Ask Ariane is unavailable.')).toBeDefined();
    expect(screen.queryByText(/no longer extended/)).toBeNull();
  });

  it('should say why an installed license does not entitle, and offer to remove it', async () => {
    renderCard({ canManagePlatform: true, installedLicense: { entitled: false, reason: 'this standard license expired on 2026-01-01T00:00:00Z', expiresAt: null, type: null } });

    expect(await screen.findByText('this standard license expired on 2026-01-01T00:00:00Z')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDefined();
  });

  // Filigran License v2 (17 Nov 2026): OpenCRQ takes its license from XTM One only.
  it('should never offer a platform administrator a way to install a license, even with no XTM One', async () => {
    renderCard({ xtmOneConfigured: false, canManagePlatform: true });

    expect(await screen.findByText('OpenCRQ takes its Filigran license from XTM One. Connect this instance to XTM One to switch it to Enterprise Edition.')).toBeDefined();
    expect(screen.queryByText('Filigran license certificate (PEM)')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
  });

  it('should offer nothing to act on to a user who does not administer the platform', async () => {
    renderCard({ xtmOneConfigured: false });

    expect(await screen.findByText('Community Edition')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('should offer no Remove on the Enterprise Edition XTM One distributes', async () => {
    renderCard({ canManagePlatform: true, edition: 'ee', licenseType: 'standard', licenseExpiresAt: inDays(200), endsAt: inDays(7) });

    expect(await screen.findByText('Distributed by XTM One')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('should say a license past its own date is in its grace period', async () => {
    renderCard({ edition: 'ee', licenseType: 'standard', licenseExpiresAt: inDays(-3), endsAt: inDays(2) });

    expect(await screen.findByText(/\(expired, in grace period\)$/)).toBeDefined();
  });

  it('should never call it an XTM license', async () => {
    renderCard({ entitlementRefusal: 'license_invalid' });

    await screen.findByText('Community Edition');
    expect(screen.queryByText(/XTM license/)).toBeNull();
  });
});
