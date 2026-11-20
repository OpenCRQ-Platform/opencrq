import { OpenTelemetryTransportV3 } from '@opentelemetry/winston-transport';
import type { LeveledLogMethod } from 'winston';
import * as winston from 'winston';
import { getProcessName, pmConfig } from '../config';

const { combine, timestamp, json, printf } = winston.format;

const logOrder = winston.format(({ timestamp: messageTimestamp, feature, level: messageLevel, message, ...others }) => ({
  timestamp: messageTimestamp,
  feature,
  level: messageLevel,
  message,
  ...others,
}));

const formatErrorForConsole = (error: unknown, prefix = ''): string => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- logger shapes are opaque; this utility handles arbitrary error-like objects
  const err = error as { name?: string, message?: string, stacktrace?: Array<string>, cause?: unknown };
  let output = `\n${prefix}${err.name || 'Error'}: ${err.message}`;
  if (err.stacktrace && Array.isArray(err.stacktrace)) {
    output += `\n${err.stacktrace.map((line: string) => `${prefix}    ${line}`).join('\n')}`;
  }
  if (err.cause) {
    output += `\n${prefix}Caused by:${formatErrorForConsole(err.cause, `${prefix}  `)}`;
  }
  return output;
};

const consoleFormat = printf(({ timestamp: messageTimestamp, level, message, feature, engine, processName, data, ...rest }) => {
  const prefix = `[${processName}]${feature ? `[${feature}]` : (engine ? `[${engine}]` : '')}`;
  let output = `${messageTimestamp} ${level} ${prefix}: ${message}`;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- winston printf destructures logger metadata as unknown; shape is controlled by our log calls
  const logData = data as Record<string, unknown> | undefined;
  if (logData) {
    const { error, ...otherData } = logData;
    if (Object.keys(otherData).length > 0) {
      output += `\n${JSON.stringify(otherData, null, 2)}`;
    }
    if (error) {
      output += formatErrorForConsole(error);
    }
  }
  if (Object.keys(rest).length > 0) {
    output += `\n${JSON.stringify(rest, null, 2)}`;
  }

  return output;
});

const createWinstonLogger = (level: string, levels?: { [key: string]: number }) => winston.createLogger({
  levels,
  level,
  format: process.env.NODE_ENV === 'production' ? combine(
    timestamp(),
    logOrder(),
    json({ deterministic: false }),
  ) : combine(
    timestamp(),
    consoleFormat,
  ),
  transports: [
    new winston.transports.Console(),
    ...(pmConfig.telemetry && pmConfig.telemetry.observability.otlp.logs.enabled) ? [new OpenTelemetryTransportV3({})] : [],
  ],
});

// Custom levels replace winston's own: a level absent from this map gets no method at all, so
// calling it throws rather than falling back. Lower is more severe, and `level` is the threshold.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- winston does not expose trace() in its types; it exists at runtime via the custom level
const technicalLogger = createWinstonLogger('trace', { error: 0, warn: 1, trace: 2 }) as unknown as (winston.Logger & { trace: LeveledLogMethod });

export interface LogMethodData {
  error?: never,
  [key: string]: unknown,
}

export interface Logger {
  logTrace: (message: string, data?: LogMethodData) => void,
  logTraceFromError: (e: unknown, message: string, data?: LogMethodData) => void,
  logWarn: (message: string, data?: LogMethodData) => void,
  logError: (message: string, data?: LogMethodData) => void,
  logFromError: (e: unknown, message: string, data?: LogMethodData) => void,
  logFatalError: (message: string, data?: LogMethodData) => never,
  logFromFatalError: (e: unknown, message: string, data?: LogMethodData) => never,
  enrich: (extraData: LogMethodData, prefix?: string) => Logger,
}

const enrichLogger = (logger: Omit<Logger, 'enrich'>, extraData: LogMethodData, prefix?: string): Logger => {
  const getMessage = (message: string): string => (prefix ? `${prefix}${message}` : message);
  const enrichedLogger: Omit<Logger, 'enrich'> = {
    ...logger,
    logWarn: (message, data) => logger.logWarn(getMessage(message), { ...data, ...extraData }),
    logError: (message, data) => logger.logError(getMessage(message), { ...data, ...extraData }),
    logFromError: (e, message, data) => logger.logFromError(e, getMessage(message), { ...data, ...extraData }),
    logFatalError: (message, data) => logger.logFatalError(getMessage(message), { ...data, ...extraData }),
    logFromFatalError: (e, message, data) => logger.logFromFatalError(e, getMessage(message), { ...data, ...extraData }),
    logTrace: (message, data) => logger.logTrace(getMessage(message), { ...data, ...extraData }),
    logTraceFromError: (e, message, data) => logger.logTraceFromError(e, getMessage(message), { ...data, ...extraData }),
  };
  return { ...enrichedLogger, enrich: (childExtraData: LogMethodData, childPrefix?: string): Logger => enrichLogger(enrichedLogger, childExtraData, childPrefix) };
};

/** A line as it was written, before any format is applied. */
export interface LogSinkLine {
  level: 'trace' | 'error',
  message: string,
  error?: unknown,
}

export type LogSink = (line: LogSinkLine) => void;

let logSink: LogSink | null = null;

/**
 * Installed by the log capture feature. The logger takes the sink rather than importing the store:
 * the store reaches the database, and the database engine logs through here.
 */
export const setLogSink = (sink: LogSink | null): void => {
  logSink = sink;
};

const emitToSink = (level: LogSinkLine['level'], message: string, error?: unknown): void => {
  if (!logSink) {
    return;
  }
  try {
    logSink({ level, message, error });
  } catch {
    // A failure to capture a line must never reach the work that wrote it.
  }
};

const errorKeys = new Set(['name', 'message', 'stacktrace', 'cause']);
const filteredErrorProperties = (error: Error) => Object.fromEntries(
  Object.entries(error).filter(([key]) => !(errorKeys).has(key)),
);
const errorToObject = (maybeError: unknown): Record<string, unknown> => {
  const error = maybeError instanceof Error ? maybeError : new Error('Unknown error type');
  return {
    name: error.name && error.name !== 'Error' ? error.name : undefined,
    message: error.message,
    cause: error.cause ? errorToObject(error.cause) : undefined,
    ...filteredErrorProperties(error),
    stacktrace: error.stack?.split('\n').map((line) => line.trim()).filter((line, i) => line.length > 0 && (i > 0)),
  };
};

export const createLogger = (tags?: { engine: string } | { feature: string }): Logger => {
  const processName = getProcessName();

  const logTrace: Logger['logTrace'] = (message, data) => {
    const technicalLogData = { data, processName, ...tags };
    technicalLogger.trace(message, technicalLogData);
    emitToSink('trace', message);
  };

  const logTraceFromError: Logger['logTraceFromError'] = (e, message, data) => {
    const technicalLogData = { data: { ...data, error: errorToObject(e) }, processName, ...tags };
    technicalLogger.trace(message, technicalLogData);
    emitToSink('trace', message, e);
  };

  /**
   * Captured as a trace, since the sink's levels are the vocabulary the job log stores and renders.
   * The distinction a warning carries is for whoever reads the technical logs.
   */
  const logWarn: Logger['logWarn'] = (message, data) => {
    const technicalLogData = { data, processName, ...tags };
    technicalLogger.warn(message, technicalLogData);
    emitToSink('trace', message);
  };

  const logError: Logger['logError'] = (message, data) => {
    const technicalLogData = { data, processName, ...tags };
    technicalLogger.error(message, technicalLogData);
    emitToSink('error', message);
  };

  const logFromError: Logger['logFromError'] = (e, message, data) => {
    const technicalLogData = { data: { ...data, error: errorToObject(e) }, processName, ...tags };
    technicalLogger.error(message, technicalLogData);
    emitToSink('error', message, e);
  };

  const logger: Omit<Logger, 'enrich'> = {
    logTrace,
    logTraceFromError,
    logWarn,
    logError,
    logFromError,
    logFatalError: (message, data) => {
      logError(message, data);
      logError('Fatal error, exiting process');
      return process.exit(1);
    },
    logFromFatalError: (e, message, data) => {
      logFromError(e, message, data);
      logError('Fatal error, exiting process');
      return process.exit(1);
    },
  };

  return { ...logger, enrich: (extraData: LogMethodData, prefix?: string) => enrichLogger(logger, extraData, prefix) };
};
