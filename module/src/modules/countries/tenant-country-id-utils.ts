import { deriveSeedId } from '../../seed-ids';
import { countriesData } from './data/countries-data';

/**
 * The ISO alpha-3 code of a tenant's country row, from its id alone. A tenant's country id is
 * `deriveSeedId(tenantId, catalogId)` (see `buildCountryRows`), so the code is a deterministic
 * derivation rather than a join: a reader that must not subscribe to the countries table (the
 * loss-estimate derivation) still gets it. `null` for no country or an id no catalog entry mints.
 */
export const resolveCountryIsoAlpha3 = (tenantId: string, countryId: string | null | undefined): string | null => {
  if (!countryId) {
    return null;
  }
  return countriesData.find((country) => deriveSeedId(tenantId, country.id) === countryId)?.isoAlpha3 ?? null;
};
