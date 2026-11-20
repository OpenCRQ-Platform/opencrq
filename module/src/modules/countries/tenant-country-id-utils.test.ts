import { describe, expect, it } from 'vitest';
import { deriveSeedId } from '../../seed-ids';
import { countryCatalogId } from './data/countries-seed';
import { resolveCountryIsoAlpha3 } from './tenant-country-id-utils';

const TENANT_ID = '019a0000-0000-7000-8000-000000000001';

describe('resolveCountryIsoAlpha3', () => {
  it('reads the ISO alpha-3 code back from a tenant country id', () => {
    expect(resolveCountryIsoAlpha3(TENANT_ID, deriveSeedId(TENANT_ID, countryCatalogId('FRA')))).toBe('FRA');
  });

  it('answers null for no country, another tenant\'s id, or an unknown id', () => {
    const otherTenantId = '019a0000-0000-7000-8000-000000000002';
    expect(resolveCountryIsoAlpha3(TENANT_ID, null)).toBeNull();
    expect(resolveCountryIsoAlpha3(TENANT_ID, deriveSeedId(otherTenantId, countryCatalogId('FRA')))).toBeNull();
    expect(resolveCountryIsoAlpha3(TENANT_ID, '019a0000-0000-7000-8000-0000000000ff')).toBeNull();
  });
});
