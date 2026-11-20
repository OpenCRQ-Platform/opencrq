import { defineRepository } from '../../registry';

export const countriesRepository = defineRepository({
  findAllCountries: ({ db, views }) => db.select().from(views.countries),
});
