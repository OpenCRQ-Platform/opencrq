/**
 * Orders two strings by code point, never by the host's collation.
 *
 * `localeCompare` gives '-' a variable ICU weight, so a UUID or an ATT&CK external id sorts
 * differently from one container to the next.
 */
export const compareCodePoints = (first: string, second: string): number => {
  if (first === second) {
    return 0;
  }
  return first < second ? -1 : 1;
};
