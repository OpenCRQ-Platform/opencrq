/**
 * Returns the value only when it is a syntactically valid http(s) URL
 * (whitespace and trailing slashes trimmed), otherwise null. Guards against
 * a misconfigured XTM One URL (e.g. a `javascript:` scheme) ever reaching an
 * anchor href or `window.open`. The input is trimmed up-front: the WHATWG
 * URL parser silently ignores surrounding whitespace, so returning the raw
 * value would let e.g. an env-var newline survive "sanitization".
 */
export const toHttpUrl = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const { protocol } = new URL(trimmed);
    return protocol === 'http:' || protocol === 'https:'
      ? trimmed.replace(/\/+$/, '')
      : null;
  } catch {
    return null;
  }
};
