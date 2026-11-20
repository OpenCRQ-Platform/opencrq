import { describe, expect, it } from 'vitest';
import { chartLocaleOptions } from './chart-locale-utils';

describe('chartLocaleOptions', () => {
  it('should name the months and days in English', () => {
    const [locale] = chartLocaleOptions('en').locales ?? [];
    expect(chartLocaleOptions('en').defaultLocale).toBe('en');
    expect(locale?.name).toBe('en');
    expect(locale?.options?.shortMonths).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
    expect(locale?.options?.months?.[7]).toBe('August');
    expect(locale?.options?.shortDays).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(locale?.options?.days?.[0]).toBe('Sunday');
  });

  it('should name the months and days in French, with the abbreviation dots the tooltip writes', () => {
    const [locale] = chartLocaleOptions('fr').locales ?? [];
    expect(chartLocaleOptions('fr').defaultLocale).toBe('fr');
    expect(locale?.name).toBe('fr');
    expect(locale?.options?.shortMonths).toEqual(['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']);
    expect(locale?.options?.months?.[7]).toBe('août');
    expect(locale?.options?.shortDays).toEqual(['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']);
    expect(locale?.options?.days?.[0]).toBe('dimanche');
  });
});
