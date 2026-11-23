const UNIQUE_VIOLATION_CODE = '23505';
const FOREIGN_KEY_VIOLATION_CODE = '23503';
const INVALID_REGULAR_EXPRESSION_CODE = '2201B';

/**
 * Walks the `cause` chain: Drizzle wraps the driver's error, which carries the code and the
 * constraint. Without a `constraint`, any violation of the code matches.
 */
const isViolationOf = (error: unknown, code: string, constraint: string | undefined): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const withMetadata = error as {
    code?: unknown,
    constraint?: unknown,
    cause?: unknown,
  };

  if (
    withMetadata.code === code
    && (constraint === undefined || withMetadata.constraint === constraint)
  ) {
    return true;
  }

  return isViolationOf(withMetadata.cause, code, constraint);
};

export const isUniqueViolationOf = (error: unknown, constraint?: string): boolean => isViolationOf(error, UNIQUE_VIOLATION_CODE, constraint);

export const isForeignKeyViolationOf = (error: unknown, constraint?: string): boolean => isViolationOf(error, FOREIGN_KEY_VIOLATION_CODE, constraint);

/** A pattern handed to `~` or `~*` that PostgreSQL cannot compile. */
export const isInvalidRegularExpression = (error: unknown): boolean => isViolationOf(error, INVALID_REGULAR_EXPRESSION_CODE, undefined);
