import { includesFolded } from '@app/utils/text-fold';

/** A Combobox `filterOptions` keeping the options whose label holds the input, accents and case aside; a blank input keeps all. */
export const filterOptionsByLabel = <T>(getLabel: (option: T) => string) =>
  (options: Array<T>, input: string): Array<T> => options.filter((option) => includesFolded(getLabel(option), input));
