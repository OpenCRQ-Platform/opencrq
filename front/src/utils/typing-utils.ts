/**
 * Returns a typed identity function that validates at compile time that the
 * provided array contains **all** members of the union type `T`.
 *
 * If any member is missing, TypeScript will report an error indicating the
 * missing value(s).
 *
 * @example
 * type Color = 'red' | 'green' | 'blue';
 * const colors = arrayOfAll<Color>()(['red', 'green', 'blue']); // ok
 * const bad = arrayOfAll<Color>()(['red', 'green']); // TS error: missing 'blue'
 */
export const arrayOfAll = <T>() =>
  <const U extends ReadonlyArray<T>>(array: [T] extends [U[number]] ? U : [...U, Exclude<T, U[number]>]) => array;
