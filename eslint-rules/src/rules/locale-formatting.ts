type NoRestrictedSyntaxEntry = { selector: string, message: string };

// esquery reads an absent attribute as the string "undefined", so the name alone would match any call.
const NO_LOCALE = ':matches([arguments.length=0], [arguments.0.type="Identifier"][arguments.0.name="undefined"], [arguments.0.type="UnaryExpression"][arguments.0.operator="void"])';

const TO_LOCALE_CALL = 'CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]';
const INTL_FORMATTER = ':matches(NewExpression, CallExpression)[callee.object.name="Intl"][callee.property.name=/^(DateTimeFormat|NumberFormat|ListFormat|RelativeTimeFormat|PluralRules|Collator|DisplayNames|Segmenter)$/]';
const BROWSER_LANGUAGE = 'MemberExpression[property.name=/^languages?$/]:matches([object.name="navigator"], [object.property.name="navigator"])';
const BARE_APPLICATION_LOCALE = '[arguments.0.type="MemberExpression"][arguments.0.object.name="i18n"][arguments.0.property.name="locale"]';

/**
 * Spread into a workspace's `no-restricted-syntax` array (never into a rules object) to flag a date,
 * time or number formatted with no locale, or with the browser's own language handed straight to the
 * formatter. The runtime then speaks a language the user did not choose for the application: the same
 * screen reads "Oct 9, 2026" in one place and "09/10/2026" in another. Reading `navigator.language`
 * to pick a default is not flagged, only passing it to a formatter. `toFixed` is flagged too, since it
 * takes no locale and always writes a `.`.
 */
export const localeFormattingSelectors: Array<NoRestrictedSyntaxEntry> = [
  {
    selector: `${TO_LOCALE_CALL}${NO_LOCALE}`,
    message: 'Pass the application locale, `i18n.locale || \'en\'`, or use `formatDate`, `formatDateTime`, `formatTimeOfDay` (utils/date-utils) or `formatNumber` (utils/format-number): with no locale the browser\'s language wins over the one chosen in the application.',
  },
  {
    selector: `${INTL_FORMATTER}${NO_LOCALE}`,
    message: 'Pass the application locale, `i18n.locale || \'en\'`, as the first argument: with no locale the browser\'s language wins over the one chosen in the application. Reading the browser\'s own time zone, which formats nothing, may say so: // eslint-disable-next-line no-restricted-syntax -- <what it reads>',
  },
  {
    selector: `:matches(${TO_LOCALE_CALL}, ${INTL_FORMATTER}) > :matches(${BROWSER_LANGUAGE}, :has(${BROWSER_LANGUAGE}))`,
    message: 'The browser\'s language is not the one chosen in the application: pass `i18n.locale || \'en\'` to the formatter instead of `navigator.language`.',
  },
  {
    selector: `:matches(${TO_LOCALE_CALL}, ${INTL_FORMATTER})${BARE_APPLICATION_LOCALE}`,
    message: 'Pass `i18n.locale || \'en\'`, or use a shared formatter (`formatDateWith`, `formatList`, `formatNumber`): `i18n.locale` is empty until a catalogue is active, in a test for instance, and the formatter then throws `RangeError: Invalid language tag`.',
  },
  {
    selector: 'CallExpression[callee.property.name="toFixed"]',
    message: '`toFixed` always writes a `.`, whatever the application language, and rounds the binary value: print with `formatFixed`, `formatAtMost` or `formatFractionAsPercent` (utils/format-number), and round a number you compute on with `roundToDecimals` (@app/utils/decimals). A figure written for a machine, SVG path data or an API field, may say so: // eslint-disable-next-line no-restricted-syntax -- <what reads it>',
  },
];
