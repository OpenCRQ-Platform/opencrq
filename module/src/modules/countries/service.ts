import { defineService } from '../../registry';
import { countriesRepository } from './repository';

export const countriesService = defineService(
  'countries',
  countriesRepository,
).implement({
  getCountries: async ({ repo }) => await repo.findAllCountries(),
});
