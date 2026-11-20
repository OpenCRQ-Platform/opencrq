import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import type { SupportedLocale } from './locale-utils';
import { userPreferenceCollection } from '../stores/user-preference-collection';
import { AUTOMATIC_LOCALE, isSupportedLocale } from './locale-utils';

export const getSupportedLocales = () => [
  { value: 'en' as const, label: t`English` },
  { value: 'fr' as const, label: t`French` },
];

export const getLocaleSettingOptions = () => [
  { value: AUTOMATIC_LOCALE, label: t`Automatic`, isAutomatic: true },
  ...getSupportedLocales().map((locale) => ({ ...locale, isAutomatic: false })),
];

/** Caches the resolved locale, never the setting: the bootstrap reads it before any server call. */
export const rememberLocale = (locale: SupportedLocale): void => {
  if (userPreferenceCollection.has('user-preference')) {
    userPreferenceCollection.update('user-preference', (draft) => {
      draft.locale = locale;
    });
  } else {
    userPreferenceCollection.insert({ id: 'user-preference', theme: 'system', locale });
  }
};

export const loadCatalog = async (locale: string): Promise<void> => {
  const validLocale = isSupportedLocale(locale) ? locale : 'en';
  const { messages } = await import(`../locales/${validLocale}/messages.po`);
  i18n.load(validLocale, messages);
  i18n.activate(validLocale);
  document.documentElement.lang = validLocale;
  rememberLocale(validLocale);
};

export { i18n };
