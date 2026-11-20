// The value is bound as a query parameter, so `%`/`_` cannot inject a different predicate — only
// escaping makes them behave as literal characters rather than a LIKE wildcard.
export const escapeLikePattern = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);
