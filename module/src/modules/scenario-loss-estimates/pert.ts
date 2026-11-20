export const computePertExpectedValue = (min: number, likely: number, max: number): number =>
  (min + 4 * likely + max) / 6;
