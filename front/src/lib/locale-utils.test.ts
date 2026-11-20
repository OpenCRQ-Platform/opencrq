import { describe, expect, it } from 'vitest';
import { browserLocale, fromLocaleSelectValue, localeSyncStep, resolveLocale, syncedLocale, toLocaleSelectValue } from './locale-utils';

describe('browserLocale', () => {
  it('should match a regional variant on its primary subtag', () => {
    expect(browserLocale(['fr-CA'])).toBe('fr');
  });

  it('should take the first supported language in the browser order', () => {
    expect(browserLocale(['de-DE', 'fr', 'en'])).toBe('fr');
  });

  it('should be null when no language is supported', () => {
    expect(browserLocale(['de', 'es-ES'])).toBeNull();
    expect(browserLocale([])).toBeNull();
  });
});

describe('resolveLocale', () => {
  it('should take the user\'s own language first', () => {
    expect(resolveLocale({ userLocale: 'en', tenantLocale: 'fr', browserLanguages: ['fr'] })).toBe('en');
  });

  it('should take the tenant default when the user is on Automatic', () => {
    expect(resolveLocale({ userLocale: null, tenantLocale: 'fr', browserLanguages: ['en'] })).toBe('fr');
  });

  it('should take the browser language when the user and the tenant are on Automatic', () => {
    expect(resolveLocale({ userLocale: null, tenantLocale: null, browserLanguages: ['fr-FR', 'en'] })).toBe('fr');
  });

  it('should fall back to English when the browser language is not supported', () => {
    expect(resolveLocale({ userLocale: null, tenantLocale: null, browserLanguages: ['de'] })).toBe('en');
  });

  it('should read an unsupported stored setting as Automatic', () => {
    expect(resolveLocale({ userLocale: 'de', tenantLocale: 'xx', browserLanguages: ['fr'] })).toBe('fr');
  });
});

describe('syncedLocale', () => {
  const browserLanguages = ['fr'];

  it('should keep the shown locale until the user setting is read', () => {
    expect(syncedLocale({ userLocale: undefined, tenantId: 't', tenantLocale: 'en', browserLanguages })).toBeNull();
  });

  it('should apply the user\'s own language without waiting for the tenant', () => {
    expect(syncedLocale({ userLocale: 'en', tenantId: 't', tenantLocale: undefined, browserLanguages })).toBe('en');
    expect(syncedLocale({ userLocale: 'en', tenantId: null, tenantLocale: undefined, browserLanguages })).toBe('en');
  });

  it('should keep the shown locale outside a tenant for a user on Automatic', () => {
    expect(syncedLocale({ userLocale: null, tenantId: null, tenantLocale: undefined, browserLanguages })).toBeNull();
  });

  it('should keep the shown locale until the tenant default is read', () => {
    expect(syncedLocale({ userLocale: null, tenantId: 't', tenantLocale: undefined, browserLanguages })).toBeNull();
  });

  it('should resolve the tenant default, then the browser, for a user on Automatic', () => {
    expect(syncedLocale({ userLocale: null, tenantId: 't', tenantLocale: 'en', browserLanguages })).toBe('en');
    expect(syncedLocale({ userLocale: null, tenantId: 't', tenantLocale: null, browserLanguages })).toBe('fr');
  });
});

describe('localeSyncStep', () => {
  const step = (overrides: Partial<Parameters<typeof localeSyncStep>[0]>) => localeSyncStep({
    target: 'fr', shown: 'en', isFirstSync: false, tenantSwitched: false, ...overrides,
  });

  it('should keep the locale shown while the server has not answered', () => {
    expect(step({ target: null, isFirstSync: true })).toBe('keep');
  });

  it('should keep the locale shown when it is already the target', () => {
    expect(step({ shown: 'fr', tenantSwitched: true })).toBe('keep');
  });

  it('should switch the catalog live on the first answer after boot', () => {
    expect(step({ isFirstSync: true, tenantSwitched: true })).toBe('load');
  });

  it('should reload on a tenant switch that changes the language', () => {
    expect(step({ tenantSwitched: true })).toBe('reload');
  });

  it('should only remember a change pushed within the same tenant, so an edit in progress survives', () => {
    expect(step({})).toBe('remember');
  });
});

describe('locale select values', () => {
  it('should hold Automatic for a null setting and back', () => {
    expect(toLocaleSelectValue(null)).toBe('auto');
    expect(fromLocaleSelectValue('auto')).toBeNull();
  });

  it('should hold a supported locale as itself', () => {
    expect(toLocaleSelectValue('fr')).toBe('fr');
    expect(fromLocaleSelectValue('fr')).toBe('fr');
  });
});
