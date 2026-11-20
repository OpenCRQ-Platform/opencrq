import { Linter } from 'eslint';
import typescriptEslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { localeFormattingSelectors } from './locale-formatting';

const lint = (code: string) => new Linter().verify(code, {
  languageOptions: { parser: typescriptEslint.parser },
  rules: { 'no-restricted-syntax': ['error', ...localeFormattingSelectors] },
});

describe('localeFormattingSelectors', () => {
  it('flags a date, a time or a number formatted with no argument', () => {
    expect(lint('new Date().toLocaleDateString();')).toHaveLength(1);
    expect(lint('new Date().toLocaleString();')).toHaveLength(1);
    expect(lint('new Date().toLocaleTimeString();')).toHaveLength(1);
    expect(lint('count.toLocaleString();')).toHaveLength(1);
  });

  it('flags an explicit undefined locale, options or not', () => {
    expect(lint('date.toLocaleDateString(undefined, { month: \'short\' });')).toHaveLength(1);
    expect(lint('new Intl.DateTimeFormat(undefined, { month: \'short\' });')).toHaveLength(1);
  });

  it('flags `void 0`, which is undefined spelled another way', () => {
    expect(lint('count.toLocaleString(void 0, { maximumFractionDigits: 1 });')).toHaveLength(1);
    expect(lint('new Intl.NumberFormat(void 0);')).toHaveLength(1);
  });

  it('flags the browser\'s language passed as the locale, which is the same bug spelled out', () => {
    expect(lint('count.toLocaleString(navigator.language);')).toHaveLength(1);
    expect(lint('new Intl.NumberFormat(navigator.languages[0]);')).toHaveLength(1);
    expect(lint('new Intl.DateTimeFormat(window.navigator.language);')).toHaveLength(1);
    expect(lint('new Intl.NumberFormat(locale ?? navigator.language);')).toHaveLength(1);
  });

  it('leaves alone a read of the browser\'s language that is not handed to a formatter', () => {
    expect(lint('const locale = navigator.language;')).toHaveLength(0);
    expect(lint('const [first] = globalThis.navigator.languages;')).toHaveLength(0);
    expect(lint('const initial = user.language === \'auto\' ? navigator.language : user.language;')).toHaveLength(0);
  });

  it('leaves alone a member named language on something that is not the navigator', () => {
    expect(lint('count.toLocaleString(user.language);')).toHaveLength(0);
    expect(lint('new Intl.NumberFormat(settings.navigator.theme);')).toHaveLength(0);
  });

  it('flags the formatters that format names and text, not only dates and numbers', () => {
    expect(lint('new Intl.DisplayNames(undefined, { type: \'region\' });')).toHaveLength(1);
    expect(lint('new Intl.DisplayNames();')).toHaveLength(1);
    expect(lint('new Intl.Segmenter();')).toHaveLength(1);
  });

  it('flags a call through optional chaining', () => {
    expect(lint('count?.toLocaleString();')).toHaveLength(1);
  });

  it('flags an Intl formatter built with no locale, with or without new', () => {
    expect(lint('new Intl.NumberFormat();')).toHaveLength(1);
    expect(lint('Intl.NumberFormat();')).toHaveLength(1);
    expect(lint('new Intl.ListFormat();')).toHaveLength(1);
    expect(lint('new Intl.RelativeTimeFormat();')).toHaveLength(1);
    expect(lint('new Intl.PluralRules();')).toHaveLength(1);
    expect(lint('new Intl.Collator();')).toHaveLength(1);
  });

  it('lets a call through when it names a locale', () => {
    expect(lint('date.toLocaleDateString(i18n.locale || \'en\', { month: \'short\' });')).toHaveLength(0);
    expect(lint('date.toLocaleString(locale);')).toHaveLength(0);
    expect(lint('count.toLocaleString(\'en-US\');')).toHaveLength(0);
    expect(lint('new Intl.NumberFormat(locale).format(count);')).toHaveLength(0);
    expect(lint('new Intl.DisplayNames(locale, { type: \'region\' });')).toHaveLength(0);
    expect(lint('new Intl.Segmenter(locale);')).toHaveLength(0);
    expect(lint('new Intl.DateTimeFormat(\'en-US\', { timeZone });')).toHaveLength(0);
  });

  it('leaves alone a method sharing the name prefix that is not a formatter', () => {
    expect(lint('name.toLocaleLowerCase();')).toHaveLength(0);
    expect(lint('name.toLocaleUpperCase();')).toHaveLength(0);
  });

  it('leaves alone an Intl function that is not a formatter', () => {
    expect(lint('Intl.supportedValuesOf(\'timeZone\');')).toHaveLength(0);
  });

  it('leaves alone a constructor that is not on Intl', () => {
    expect(lint('new Foo.NumberFormat();')).toHaveLength(0);
  });

  it('flags the application locale with no fallback, which is empty until a catalogue is active', () => {
    expect(lint('new Intl.ListFormat(i18n.locale, { type: \'conjunction\' });')).toHaveLength(1);
    expect(lint('date.toLocaleDateString(i18n.locale, { month: \'long\' });')).toHaveLength(1);
    expect(lint('new Intl.NumberFormat(i18n.locale || \'en\');')).toHaveLength(0);
  });

  it('flags toFixed, which writes a dot in every language', () => {
    expect(lint('value.toFixed(1);')).toHaveLength(1);
    expect(lint('(a / b).toFixed(2);')).toHaveLength(1);
  });
});
