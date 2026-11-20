import { countries } from '@app/module';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { router } from '../../../trpc';

const CountriesSchema = createSelectSchema(countries).pick({ id: true, name: true, isoAlpha2: true, isoAlpha3: true });

export const countriesRouter = (procedure: TenantProcedure) => router({
  // bounded-by: the country catalogue, 250 rows seeded into every tenant
  getCountries: procedure
    .output(z.array(CountriesSchema))
    .query(({ ctx: { services, origin } }) => services.withOrigin(origin)
      .countries.getCountries()),
});
