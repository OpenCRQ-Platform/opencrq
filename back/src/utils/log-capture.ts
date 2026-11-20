import { uuidv7 } from 'uuidv7';
// Type-only: the logger reads the deployment configuration at import time, and this module is
// reached from the job runtime, which must stay loadable without one.
import type { LogSinkLine } from './logger';
import { currentExecutionScope } from './execution-scope';

const FLUSH_INTERVAL_MS = 1_000;
const FLUSH_LINE_COUNT = 100;
/** Past this the store is behind the work being logged; the console still holds every line. */
const MAX_PENDING_LINES = 5_000;
/** A scope the store trims only when it ends cannot write without bound meanwhile. Kept below the
 *  buffer's own cap, or the line saying capture stopped would itself be dropped. */
const SCOPE_LINE_CEILING = 2_000;
const MAX_DETAIL_LENGTH = 2_000;
const CAUSE_SEPARATOR = ' | caused by: ';

const REDACTED = '[redacted]';
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const SCHEME_CREDENTIAL = /\b((?:Bearer|Basic|Digest|Negotiate|NTLM)\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
/** The key may carry a prefix (`access_token`, `clientSecret`): `_` is a word character, so `\b` alone misses it. */
const ASSIGNED_SECRET = /((?:api[_-]?key|[\w-]*(?:secret|token|password|passwd|pwd|authorization))\b"?\s*[:=]\s*"?)(?!(?:Bearer|Basic|Digest|Negotiate|NTLM)\b)([^"'\s,&}]{4,})/gi;

/**
 * A third-party error body is quoted verbatim into a line the tenant then reads, and nothing
 * guarantees it carries no credential. `SCHEME_CREDENTIAL` must run before `ASSIGNED_SECRET`, which
 * would otherwise consume the scheme word as the value of an `Authorization:` key and leave the
 * credential itself in clear.
 */
export const redactSecrets = (text: string): string => text
  .replace(JWT, REDACTED)
  .replace(SCHEME_CREDENTIAL, `$1${REDACTED}`)
  .replace(ASSIGNED_SECRET, `$1${REDACTED}`);

export interface CapturedLogLine {
  id: string,
  tenantId: string,
  jobId: string | null,
  scopeId: string,
  scopeKind: string,
  level: 'trace' | 'error',
  message: string,
  detail: string | null,
  occurredAt: Date,
}

/** Stores one batch. Injected rather than imported: storing reaches the database, which logs here. */
export type LogCaptureWriter = (lines: ReadonlyArray<CapturedLogLine>) => Promise<void>;

export const describeError = (error: unknown): string => {
  const parts: Array<string> = [];
  let current: unknown = error;
  while (current instanceof Error && parts.length < 5) {
    parts.push(current.name && current.name !== 'Error' ? `${current.name}: ${current.message}` : current.message);
    current = current.cause;
  }
  return (parts.length > 0 ? parts.join(CAUSE_SEPARATOR) : String(error)).slice(0, MAX_DETAIL_LENGTH);
};

interface CaptureState {
  pending: Array<CapturedLogLine>,
  linesByScope: Map<string, number>,
  inFlight: Promise<void>,
  timer: ReturnType<typeof setInterval>,
  writer: LogCaptureWriter,
}

let state: CaptureState | null = null;

const doFlush = async (): Promise<void> => {
  if (!state || state.pending.length === 0) {
    return;
  }
  const batch = state.pending;
  state.pending = [];
  try {
    await state.writer(batch);
  } catch (err) {
    // Never through the logger this sink serves: the report would be captured, fail, and report itself.
    // eslint-disable-next-line no-console
    console.error(`[job-logs] dropped ${batch.length} captured log lines: ${err instanceof Error ? err.message : String(err)}`);
  }
};

const flush = (): Promise<void> => {
  if (!state) {
    return Promise.resolve();
  }
  state.inFlight = state.inFlight.then(doFlush, doFlush);
  return state.inFlight;
};

export const captureLine = (line: LogSinkLine): void => {
  const scope = currentExecutionScope();
  if (!state || !scope) {
    return;
  }
  let ceilingReached = false;
  if (scope.retention === 'on-scope-end') {
    const written = state.linesByScope.get(scope.scopeId) ?? 0;
    if (written > SCOPE_LINE_CEILING) {
      return;
    }
    state.linesByScope.set(scope.scopeId, written + 1);
    ceilingReached = written === SCOPE_LINE_CEILING;
  }
  if (state.pending.length >= MAX_PENDING_LINES) {
    return;
  }
  state.pending.push({
    id: uuidv7(),
    tenantId: scope.tenantId,
    jobId: scope.jobId,
    scopeId: scope.scopeId,
    scopeKind: scope.scopeKind,
    level: line.level,
    message: ceilingReached ? 'Log capture stopped here: this run wrote too many lines' : redactSecrets(line.message),
    detail: ceilingReached || line.error === undefined ? null : redactSecrets(describeError(line.error)),
    occurredAt: new Date(),
  });
  if (state.pending.length >= FLUSH_LINE_COUNT) {
    void flush();
  }
};

export const installLogCapture = (writer: LogCaptureWriter): void => {
  const timer = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);
  timer.unref();
  state = { pending: [], linesByScope: new Map(), inFlight: Promise.resolve(), timer, writer };
};

export const uninstallLogCapture = (): void => {
  if (!state) {
    return;
  }
  clearInterval(state.timer);
  const stopping = state;
  void flush().finally(() => {
    if (state === stopping) {
      state = null;
    }
  });
};

export const flushLogCapture = (): Promise<void> => flush();

export const endLogScope = async (scopeId: string): Promise<void> => {
  await flush();
  state?.linesByScope.delete(scopeId);
};
