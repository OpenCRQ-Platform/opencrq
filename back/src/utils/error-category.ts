const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * A value logged as a category: an error code or name is an identifier, while a message is free text
 * from another product that may name a person or carry a secret.
 */
export const logCategory = (value: unknown): string | null =>
  (typeof value === 'string' && IDENTIFIER.test(value) ? value : null);

/** An error's name and its cause's code, such as `TimeoutError` or `Error, ECONNREFUSED`. */
export const errorCategory = (err: unknown): string => {
  const name = err instanceof Error ? logCategory(err.name) : null;
  const cause = err instanceof Error && typeof err.cause === 'object' && err.cause !== null
    ? logCategory((err.cause as { code?: unknown }).code)
    : null;
  return [name ?? 'unknown error', cause].filter(Boolean).join(', ');
};
