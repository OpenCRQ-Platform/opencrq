import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AssetResolutionSource } from './asset-resolution-copy';
import { getAssetFieldCopy } from './asset-resolution-copy';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

const source = (overrides: Partial<AssetResolutionSource> = {}): AssetResolutionSource => ({
  source: 'microsoft_graph',
  origin: 'connector',
  reportedName: 'Nadia Fournier',
  reportedDescription: null,
  reportedCategoryId: 'identity',
  reportedSubcategoryId: 'user_account',
  reportedExposure: 'unknown',
  reportedCriticality: 'unknown',
  reportedCriticalityRule: null,
  reportedUrl: null,
  reportedLinkedPerson: null,
  firstSeenAt: null,
  lastSeenAt: null,
  ...overrides,
});

describe('getAssetFieldCopy — criticality', () => {
  it('says no source reports a criticality when every source filed unknown', () => {
    expect(getAssetFieldCopy('criticality', [source()], []).how).toContain('No source reports it.');
  });

  it('names the band a source did report', () => {
    expect(getAssetFieldCopy('criticality', [source({ reportedCriticality: 'high' })], []).how).toContain('Microsoft Defender: High');
  });

  it('names the rule behind a reading', () => {
    expect(getAssetFieldCopy('criticality', [source({ reportedCriticality: 'very_high', reportedCriticalityRule: 'domain_controller' })], []).how)
      .toContain('Microsoft Defender: Very High (domain controller)');
  });

  it('names the identity a lift comes from, with its band', () => {
    const copy = getAssetFieldCopy('criticality', [source()], [], { criticality: 'high', fromAsset: { name: 'Nadia Fournier', derivedName: null, criticality: 'very_high' } });

    expect(copy.how).toContain('Assigned to Nadia Fournier (Very High), which gives High. Reported — No source reports it.');
    expect(copy.how).not.toContain('..');
  });

  it('names an identity with no name by its derived name', () => {
    const copy = getAssetFieldCopy('criticality', [source()], [], { criticality: 'high', fromAsset: { name: null, derivedName: 'nadia@example.com', criticality: 'very_high' } });

    expect(copy.how).toContain('Assigned to nadia@example.com (Very High), which gives High.');
  });

  it('falls back to the unnamed label when the identity has neither name', () => {
    const copy = getAssetFieldCopy('criticality', [source()], [], { criticality: 'high', fromAsset: { name: null, derivedName: null, criticality: 'very_high' } });

    expect(copy.how).toContain('Assigned to Unnamed asset (Very High), which gives High.');
  });

  it('still says a lift is there once its identity is gone', () => {
    expect(getAssetFieldCopy('criticality', [source()], [], { criticality: 'medium', fromAsset: null }).how)
      .toContain('Assigned to an identity no longer in the inventory, which gave Medium.');
  });
});
