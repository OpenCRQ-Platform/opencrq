import { EMPTY_VALUE } from './empty-value';

export const truncateDescription = (description: string | null, maxLength = 100): string => {
  if (!description) {
    return EMPTY_VALUE;
  }
  if (description.length <= maxLength) {
    return description;
  }
  return `${description.slice(0, maxLength)}...`;
};
