export interface StructuredErrorData {
  [key: string]: unknown,
}

interface StructuredErrorOptions<T extends StructuredErrorData> extends ErrorOptions {
  data: T,
}

const formatMessage = (messageKey: string, data: StructuredErrorData) => {
  const dataStr = JSON.stringify(data);
  return (dataStr && dataStr !== '{}') ? `${messageKey} ${dataStr}` : messageKey;
};

export class StructuredError<T extends StructuredErrorData = StructuredErrorData> extends Error {
  override readonly name: string = 'StructuredError';

  /**
   * A stable code clients switch on, sent to them as the `data.reason` of a tRPC error. A subclass
   * opts in by overriding it, and renaming one breaks those clients.
   */
  readonly reason: string | null = null;

  readonly messageKey: string;

  readonly data: T;

  constructor(messageKey: string, options: StructuredErrorOptions<T>) {
    super(formatMessage(messageKey, options.data), { cause: options.cause });
    this.messageKey = messageKey;
    this.data = options.data;
  }
}

interface FromError {
  <T extends StructuredErrorData>(cause: unknown, messageKey: string, data: T): StructuredError<T>,
  (cause: unknown, messageKey: string): StructuredError,
}

export const fromError: FromError = <T extends StructuredErrorData>(cause: unknown, messageKey: string, data?: T) => (data
  ? new StructuredError<T>(messageKey, { data, cause }) : new StructuredError(messageKey, { data: {}, cause }));

interface NewError {
  <T extends StructuredErrorData>(messageKey: string, data: T): StructuredError<T>,
  (messageKey: string): StructuredError,
}

export const newError: NewError = <T extends StructuredErrorData>(messageKey: string, data?: T) => (data
  ? new StructuredError<T>(messageKey, { data }) : new StructuredError(messageKey, { data: {} }));

export interface ErrorObject {
  name: string | undefined,
  message: string,
  data: StructuredErrorData,
  stacktrace: Array<string> | undefined,
  cause: ErrorObject | { error: unknown } | undefined,
}

const errorKeys = new Set(['name', 'message', 'stacktrace', 'cause']);
const structuredErrorKeys = new Set(['name', 'message', 'messageKey', 'data', 'stacktrace', 'cause']);
const filteredErrorProperties = (error: Error) => Object.fromEntries(
  Object.entries(error).filter(([key]) => !(error instanceof StructuredError ? structuredErrorKeys : errorKeys).has(key)),
);

export const errorToObject = (maybeError: unknown): ErrorObject => {
  const error = maybeError instanceof Error ? maybeError : newError('Unknown error type', { error: maybeError });
  const isStructuredError = error instanceof StructuredError;
  return {
    name: error.name && error.name !== 'Error' ? error.name : undefined,
    message: isStructuredError ? error.messageKey : error.message,
    data: isStructuredError ? error.data : undefined,
    ...filteredErrorProperties(error),
    stacktrace: error.stack?.split('\n').map((line) => line.trim()).filter((line, i) => line.length > 0 && (!isStructuredError || i > 0)),
    cause: error.cause ? errorToObject(error.cause) : undefined,
  };
};
