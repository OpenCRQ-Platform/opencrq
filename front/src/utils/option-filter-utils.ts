/**
 * Resolves a filter value against the options a tenant actually has, for a filter whose values
 * come from data rather than a fixed enumeration (a source, a family…). `availableValues` is
 * `undefined` while the options are still loading — that must not be mistaken for "no options",
 * which would drop a perfectly live value before its list has had a chance to confirm it. Once
 * `availableValues` is known, a value it does not contain is dead (its option disappeared) and
 * falls back to `fallback`, the value that means "no filter" for this field.
 */
export const resolveOptionFilter = <TValue extends string>(
  value: TValue,
  availableValues: Array<string> | undefined,
  fallback: TValue,
): TValue => {
  if (value === fallback || availableValues === undefined) {
    return value;
  }
  return availableValues.includes(value) ? value : fallback;
};
