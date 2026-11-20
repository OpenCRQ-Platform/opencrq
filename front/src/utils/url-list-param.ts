/** Comma-separated encoding for a multi-value URL search param, e.g. `?domains=compliance,security`. */
export const parseUrlList = (raw: string | undefined): Array<string> => {
  if (raw === undefined || raw === '') {
    return [];
  }
  return raw.split(',').filter((entry) => entry !== '');
};

/** Inverse of {@link parseUrlList}; an empty list is the empty param, which `stripSearchParams` then drops. */
export const formatUrlList = (values: ReadonlyArray<string>): string =>
  values.filter((value) => value !== '').join(',');
