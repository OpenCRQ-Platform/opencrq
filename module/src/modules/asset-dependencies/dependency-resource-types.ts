import type { SupportedLocale } from '../users/validation';

export const DEPENDENCY_RESOURCE_TYPE_NAME_MAX_LENGTH = 100;

/**
 * The ISO 22301 resource categories, given to a tenant once, in its default language. The migration
 * that created the table wrote the same names for the tenants that existed then.
 */
export const DEFAULT_DEPENDENCY_RESOURCE_TYPES: ReadonlyArray<Readonly<Record<SupportedLocale, string>>> = [
  { en: 'IT', fr: 'Informatique' },
  { en: 'Supplier', fr: 'Fournisseur' },
  { en: 'Information', fr: 'Information' },
  { en: 'People', fr: 'Personnes' },
  { en: 'Premises', fr: 'Locaux' },
  { en: 'Equipment', fr: 'Équipements' },
  { en: 'Transport', fr: 'Transport' },
  { en: 'Finance', fr: 'Finance' },
];

export const defaultDependencyResourceTypeNames = (locale: SupportedLocale | null | undefined): Array<string> =>
  DEFAULT_DEPENDENCY_RESOURCE_TYPES.map((names) => names[locale ?? 'en']);
