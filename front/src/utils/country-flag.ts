// Convert an ISO Alpha-2 code to its Unicode flag emoji (zero-dependency, no static assets needed).
// Works by mapping each letter to a Regional Indicator Symbol Letter (U+1F1E6–U+1F1FF).
export const getCountryFlagEmoji = (isoAlpha2: string): string =>
  [...isoAlpha2.toUpperCase()].map((c) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
