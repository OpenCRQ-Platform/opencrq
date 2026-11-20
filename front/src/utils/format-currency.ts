import { i18n } from '@lingui/core';
import { roundToDecimals } from '@app/utils/decimals';
import { printedDollars } from '@app/utils/printed-dollars';
import { EMPTY_VALUE } from './empty-value';
import { MINUS_SIGN } from './format-number';

/** The figure a formatted number shows, its unit and symbols left out: 2.3 for "2,3 M $". */
const shownFigure = (parts: ReadonlyArray<Intl.NumberFormatPart>): number => {
  const integer = parts.filter((part) => part.type === 'integer').map((part) => part.value).join('');
  const fraction = parts.find((part) => part.type === 'fraction')?.value ?? '0';
  return Number(`${integer}.${fraction}`);
};

/**
 * A dollar amount, compact, in the application language, rounded by `printedDollars` so the
 * server's comparison agrees with the screen: "$2.3M", "$450K", "−$2.3M", in French "2,3 M $",
 * "450 k $", "1,5 Md $". A language whose compact notation does not step by a thousand (10,000 in
 * Japanese, 100,000 in Hindi, none below a million in German) gets the rounded amount in full, so
 * the screen still shows what the server compares. Returns EMPTY_VALUE for null values.
 */
export const formatDollar = (value: number | null): string => {
  if (value === null) {
    return EMPTY_VALUE;
  }
  const { amount, fractionDigits, divisor } = printedDollars(value);
  const currency = { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' } as const;
  const compact = new Intl.NumberFormat(i18n.locale || 'en', {
    ...currency,
    notation: 'compact',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).formatToParts(Math.abs(amount));
  const magnitude = shownFigure(compact) === roundToDecimals(Math.abs(amount) / divisor, fractionDigits)
    ? compact.map((part) => part.value).join('')
    : new Intl.NumberFormat(i18n.locale || 'en', { ...currency, maximumFractionDigits: 0 }).format(Math.abs(amount));
  return amount < 0 ? `${MINUS_SIGN}${magnitude}` : magnitude;
};

/**
 * A change since a previous reading, signed and formatted like `formatDollar`. A change that
 * prints as zero carries no sign, since it reads as neither a rise nor a fall.
 */
export const formatDollarChange = (value: number): string => {
  const magnitude = formatDollar(Math.abs(value));
  if (magnitude === formatDollar(0)) {
    return magnitude;
  }
  return `${value > 0 ? '+' : MINUS_SIGN}${magnitude}`;
};

/**
 * A count, compact, at no more than one decimal, in the application language: "42", "1K", "2.3M",
 * in French "1 k", "2,3 M". Returns EMPTY_VALUE for null values.
 */
export const formatCompactCount = (count: number | null): string =>
  count === null ? EMPTY_VALUE : new Intl.NumberFormat(i18n.locale || 'en', { notation: 'compact', maximumFractionDigits: 1 }).format(count);
