import { i18n } from '@lingui/core';
import { roundToDecimals } from '@app/utils/decimals';

const DECIMAL_UNITS = ['kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

/**
 * A byte count in decimal units, so the unit names what it divides by, in the application
 * language: "512 bytes", "1.5 kB", "2.3 MB", in French "512 octets", "1,5 ko", "2,3 Mo". The unit
 * moves up where the rounded figure would read 1,000.
 */
export const formatBytes = (bytes: number): string => {
  const locale = i18n.locale || 'en';
  if (bytes < 1000) {
    return new Intl.NumberFormat(locale, { style: 'unit', unit: 'byte', unitDisplay: 'long' }).format(bytes);
  }
  let value = bytes / 1000;
  let unitIndex = 0;
  while (roundToDecimals(value, 1) >= 1000 && unitIndex < DECIMAL_UNITS.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: DECIMAL_UNITS[unitIndex],
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
};
