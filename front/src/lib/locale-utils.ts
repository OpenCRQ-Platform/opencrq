export const SUPPORTED_LOCALES = ['en', 'fr'] as const;

export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

const FALLBACK_LOCALE: SupportedLocale = 'en';

export const isSupportedLocale = (value: unknown): value is SupportedLocale =>
  SUPPORTED_LOCALES.some((locale) => locale === value);

/** The first browser language the app is translated in, matched on its primary subtag (`fr-CA` is `fr`). */
export const browserLocale = (languages: ReadonlyArray<string>): SupportedLocale | null => {
  for (const language of languages) {
    const primary = language.split('-')[0]?.toLowerCase();
    if (isSupportedLocale(primary)) {
      return primary;
    }
  }
  return null;
};

/** A setting that is null or not a supported locale is Automatic, and defers to the next step. */
export const resolveLocale = ({ userLocale, tenantLocale, browserLanguages }: {
  userLocale: string | null,
  tenantLocale: string | null,
  browserLanguages: ReadonlyArray<string>,
}): SupportedLocale => {
  if (isSupportedLocale(userLocale)) {
    return userLocale;
  }
  if (isSupportedLocale(tenantLocale)) {
    return tenantLocale;
  }
  return browserLocale(browserLanguages) ?? FALLBACK_LOCALE;
};

/**
 * The locale to show once the server has answered, or null to keep the one shown. `undefined` is a
 * setting not read yet. Outside a tenant there is no tenant default to read, so only the user's own
 * language may change what is shown.
 */
export const syncedLocale = ({ userLocale, tenantId, tenantLocale, browserLanguages }: {
  userLocale: string | null | undefined,
  tenantId: string | null,
  tenantLocale: string | null | undefined,
  browserLanguages: ReadonlyArray<string>,
}): SupportedLocale | null => {
  if (userLocale === undefined) {
    return null;
  }
  if (isSupportedLocale(userLocale)) {
    return userLocale;
  }
  if (tenantId === null || tenantLocale === undefined) {
    return null;
  }
  return resolveLocale({ userLocale, tenantLocale, browserLanguages });
};

export type LocaleSyncStep = 'keep' | 'load' | 'remember' | 'reload';

/**
 * What to do once `syncedLocale` answers. A live catalog switch leaves strings a loader or a module
 * already rendered in the old language, so it is reserved for the first answer after boot. Later, a
 * reload is only worth it on a tenant switch, which already drops the page: a change pushed by
 * someone else (the tenant default, the user's own language set in another tab) must not discard
 * what this tab is editing, so it waits for the next load.
 */
export const localeSyncStep = ({ target, shown, isFirstSync, tenantSwitched }: {
  target: SupportedLocale | null,
  shown: string,
  isFirstSync: boolean,
  tenantSwitched: boolean,
}): LocaleSyncStep => {
  if (target === null || target === shown) {
    return 'keep';
  }
  if (isFirstSync) {
    return 'load';
  }
  return tenantSwitched ? 'reload' : 'remember';
};

/** The value a locale select holds for Automatic: an empty string is not a valid select value. */
export const AUTOMATIC_LOCALE = 'auto';

export const toLocaleSelectValue = (setting: string | null | undefined): string =>
  (isSupportedLocale(setting) ? setting : AUTOMATIC_LOCALE);

export const fromLocaleSelectValue = (value: string): SupportedLocale | null =>
  (isSupportedLocale(value) ? value : null);
