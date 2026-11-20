/**
 * Points taken off a posture, printed as short as they are exact: a whole exploitability reads `68`, a
 * per-finding increment `0,005`. Three decimals is the finest any term carries.
 */
export const formatPosturePoints = (value: number, locale: string): string => new Intl.NumberFormat(locale, {
  maximumFractionDigits: 3,
}).format(value);
