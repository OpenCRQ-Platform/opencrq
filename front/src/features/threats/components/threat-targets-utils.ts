import { compareText, includesFolded } from '@app/utils/text-fold';
import { buildOpenCtiObjectLink } from '../../supporting-assets/connectors-utils';
import { CONCERNS_YOU_COLOR_TOKEN, countryDisplayName } from './targeted-countries-map-utils';

/**
 * The map's amber as a chip: the label keeps its theme's text colour, so the full fill only goes
 * under the light theme's dark text, and a wash under the dark theme's light text.
 */
export const concernsYouChipStyle = (theme: 'light' | 'dark'): { borderColor: string, backgroundColor: string } => ({
  borderColor: `var(${CONCERNS_YOU_COLOR_TOKEN})`,
  backgroundColor: theme === 'light'
    ? `var(${CONCERNS_YOU_COLOR_TOKEN})`
    // eslint-disable-next-line lingui/no-unlocalized-strings -- a CSS colour, not copy
    : `color-mix(in srgb, var(${CONCERNS_YOU_COLOR_TOKEN}) 20%, transparent)`,
});

/** False when no row resolves a link, as for a threat imported from a STIX bundle. */
export const hasOpenCtiLink = (openctiUrl: string | null, rows: ReadonlyArray<{ openctiStixRelationId: string | null }>): boolean =>
  rows.some((row) => buildOpenCtiObjectLink(openctiUrl, row.openctiStixRelationId) !== null);

interface TargetedLocation {
  name: string,
  country: string | null,
  countryId: string | null,
  countryIsoAlpha2: string | null,
  matchesOrganization: boolean,
}

interface TargetedSector {
  name: string,
  sectorId: string | null,
  matchesOrganization: boolean,
}

/**
 * The name a location reads under: a country location takes its country's name in the application
 * language, as the map names it; a city or a region keeps its own.
 */
export const locationDisplayName = (location: TargetedLocation, locale: string): string => (
  location.countryIsoAlpha2 !== null && location.country !== null && compareText(location.name, location.country) === 0
    ? countryDisplayName(location.countryIsoAlpha2.toUpperCase(), locale, [location.name])
    : location.name
);

/** The name of a country the threat targets, as the map and the filter chip both name it. */
export const targetedCountryName = (
  locations: ReadonlyArray<TargetedLocation>,
  countryId: string,
  locale: string,
): string | null => {
  const location = locations.find((candidate) => candidate.countryId === countryId && candidate.countryIsoAlpha2 !== null);
  return location?.countryIsoAlpha2
    ? countryDisplayName(location.countryIsoAlpha2.toUpperCase(), locale, [location.country, location.name])
    : null;
};

/** Every country of the reference data the threat's locations resolve to. */
export const targetedCountryIds = (locations: ReadonlyArray<TargetedLocation>): Array<string> => [
  ...new Set(locations.flatMap((location) => (location.countryId === null ? [] : [location.countryId]))),
];

// What concerns the tenant first, then what the reference data recognizes, then by name.
const compareTargets = (
  first: { displayName: string, matchesOrganization: boolean, recognized: boolean },
  second: { displayName: string, matchesOrganization: boolean, recognized: boolean },
): number => Number(second.matchesOrganization) - Number(first.matchesOrganization)
  || Number(second.recognized) - Number(first.recognized)
  || compareText(first.displayName, second.displayName);

interface LocationFilters {
  search: string,
  concerningYouOnly: boolean,
  /** Empty for every country. */
  countryId: string,
}

export const filterAndOrderLocations = <T extends TargetedLocation>(
  locations: ReadonlyArray<T>,
  filters: LocationFilters,
  locale: string,
): Array<T & { displayName: string }> => {
  const search = filters.search.trim();
  return locations
    .map((location) => ({ ...location, displayName: locationDisplayName(location, locale), recognized: location.countryId !== null }))
    .filter((location) => (!filters.concerningYouOnly || location.matchesOrganization)
      && (filters.countryId === '' || location.countryId === filters.countryId)
      && (search === '' || includesFolded(location.displayName, search) || includesFolded(location.name, search)))
    .sort(compareTargets);
};

interface SectorFilters {
  search: string,
  concerningYouOnly: boolean,
}

export const filterAndOrderSectors = <T extends TargetedSector>(
  sectors: ReadonlyArray<T>,
  filters: SectorFilters,
): Array<T & { displayName: string }> => {
  const search = filters.search.trim();
  return sectors
    .map((sector) => ({ ...sector, displayName: sector.name, recognized: sector.sectorId !== null }))
    .filter((sector) => (!filters.concerningYouOnly || sector.matchesOrganization)
      && (search === '' || includesFolded(sector.name, search)))
    .sort(compareTargets);
};
