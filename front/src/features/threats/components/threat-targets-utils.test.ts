import { describe, expect, it } from 'vitest';
import { CONCERNS_YOU_COLOR_TOKEN } from './targeted-countries-map-utils';
import {
  concernsYouChipStyle,
  filterAndOrderLocations,
  filterAndOrderSectors,
  hasOpenCtiLink,
  locationDisplayName,
  targetedCountryIds,
  targetedCountryName,
} from './threat-targets-utils';

const OPENCTI_URL = 'https://opencti.example';
const RESOLVABLE_RELATION_ID = 'relationship--6f1c1d6e-1e0b-4c5a-9a55-4c8a8f0a1b2c';

describe('hasOpenCtiLink', () => {
  it('should find no link for a STIX import, whose rows carry no relationship id', () => {
    expect(hasOpenCtiLink(OPENCTI_URL, [{ openctiStixRelationId: null }, { openctiStixRelationId: null }])).toBe(false);
  });

  it('should find a link once one row resolves on the tenant\'s OpenCTI', () => {
    expect(hasOpenCtiLink(OPENCTI_URL, [{ openctiStixRelationId: null }, { openctiStixRelationId: RESOLVABLE_RELATION_ID }])).toBe(true);
  });

  it('should find no link without an OpenCTI to open it on, or with an id it cannot resolve', () => {
    expect(hasOpenCtiLink(null, [{ openctiStixRelationId: RESOLVABLE_RELATION_ID }])).toBe(false);
    expect(hasOpenCtiLink(OPENCTI_URL, [{ openctiStixRelationId: 'relationship--seed-apt28-locations-0' }])).toBe(false);
  });
});

describe('concernsYouChipStyle', () => {
  it('should paint the chip with the map\'s own amber, full under the light theme and as a wash under the dark one', () => {
    expect(concernsYouChipStyle('light')).toEqual({
      borderColor: `var(${CONCERNS_YOU_COLOR_TOKEN})`,
      backgroundColor: `var(${CONCERNS_YOU_COLOR_TOKEN})`,
    });
    expect(concernsYouChipStyle('dark').backgroundColor).toBe(`color-mix(in srgb, var(${CONCERNS_YOU_COLOR_TOKEN}) 20%, transparent)`);
  });
});

const location = (name: string, overrides: Partial<{ country: string | null, countryId: string | null, countryIsoAlpha2: string | null, matchesOrganization: boolean }> = {}) => ({
  name,
  country: name,
  countryId: `country-${name}`,
  countryIsoAlpha2: null,
  matchesOrganization: false,
  ...overrides,
});

const sector = (name: string, overrides: Partial<{ sectorId: string | null, matchesOrganization: boolean }> = {}) => ({
  name,
  sectorId: `sector-${name}`,
  matchesOrganization: false,
  ...overrides,
});

const france = location('France', { countryId: 'country-fr', countryIsoAlpha2: 'FR' });
const paris = location('Paris', { country: 'France', countryId: 'country-fr', countryIsoAlpha2: 'FR' });
const germany = location('Germany', { countryId: 'country-de', countryIsoAlpha2: 'DE', matchesOrganization: true });
const easternEurope = location('Eastern Europe', { country: null, countryId: null });

const everyLocation = { search: '', concerningYouOnly: false, countryId: '' };

describe('locationDisplayName', () => {
  it('should name a country location in the application language', () => {
    expect(locationDisplayName(france, 'fr')).toBe('France');
    expect(locationDisplayName(germany, 'fr')).toBe('Allemagne');
  });

  it('should keep the own name of a city and of a region', () => {
    expect(locationDisplayName(paris, 'fr')).toBe('Paris');
    expect(locationDisplayName(easternEurope, 'fr')).toBe('Eastern Europe');
  });
});

describe('targetedCountryName', () => {
  it('should name a targeted country as the map does', () => {
    expect(targetedCountryName([paris, germany], 'country-de', 'fr')).toBe('Allemagne');
    expect(targetedCountryName([paris], 'country-fr', 'en')).toBe('France');
  });

  it('should name no country the threat does not target', () => {
    expect(targetedCountryName([paris], 'country-de', 'en')).toBeNull();
  });
});

describe('targetedCountryIds', () => {
  it('should list each recognized country once', () => {
    expect(targetedCountryIds([france, paris, germany, easternEurope])).toEqual(['country-fr', 'country-de']);
  });
});

describe('filterAndOrderLocations', () => {
  it('should put what concerns the tenant first, then what is recognized, then by name', () => {
    const rows = filterAndOrderLocations([easternEurope, paris, france, germany], everyLocation, 'en');

    expect(rows.map((row) => row.displayName)).toEqual(['Germany', 'France', 'Paris', 'Eastern Europe']);
  });

  it('should keep only the locations of the country picked on the map', () => {
    const rows = filterAndOrderLocations([france, paris, germany], { ...everyLocation, countryId: 'country-fr' }, 'en');

    expect(rows.map((row) => row.name)).toEqual(['France', 'Paris']);
  });

  it('should keep only what concerns the tenant when asked', () => {
    const rows = filterAndOrderLocations([france, germany], { ...everyLocation, concerningYouOnly: true }, 'en');

    expect(rows.map((row) => row.name)).toEqual(['Germany']);
  });

  it('should search the name shown as well as the name received, ignoring case and accents', () => {
    expect(filterAndOrderLocations([germany, france], { ...everyLocation, search: 'allemagne' }, 'fr').map((row) => row.name)).toEqual(['Germany']);
    expect(filterAndOrderLocations([germany, france], { ...everyLocation, search: 'GERMANY' }, 'fr').map((row) => row.name)).toEqual(['Germany']);
    expect(filterAndOrderLocations([germany, france], { ...everyLocation, search: 'franç' }, 'en').map((row) => row.name)).toEqual(['France']);
  });
});

describe('filterAndOrderSectors', () => {
  const finance = sector('Finance', { matchesOrganization: true });
  const energy = sector('Energy');
  const thinkTanks = sector('Think tanks', { sectorId: null });

  it('should put what concerns the tenant first, then what is recognized, then by name', () => {
    const rows = filterAndOrderSectors([thinkTanks, energy, finance], { search: '', concerningYouOnly: false });

    expect(rows.map((row) => row.name)).toEqual(['Finance', 'Energy', 'Think tanks']);
  });

  it('should filter on the search and on what concerns the tenant', () => {
    expect(filterAndOrderSectors([thinkTanks, energy, finance], { search: 'ener', concerningYouOnly: false }).map((row) => row.name)).toEqual(['Energy']);
    expect(filterAndOrderSectors([thinkTanks, energy, finance], { search: '', concerningYouOnly: true }).map((row) => row.name)).toEqual(['Finance']);
  });
});
