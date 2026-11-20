// Pure classification helpers for client-side error reporting. No React, no tRPC client, no
// `fetch`, no `navigator` — kept trivially testable; the online check and the actual sending
// live on the queue (`stores/client-report-queue.ts`).

import { CLIENT_ERROR_REPORT_LIMITS } from '@app/module/client';
import type { ClientErrorKind, ClientErrorReport } from '@app/module/client';
import type { NavigationLogs } from '../stores/navigation-store';

const MAX_NAVIGATION_HISTORY_LENGTH = CLIENT_ERROR_REPORT_LIMITS.maxNavigationHistoryLength;

// A wrapper can point `cause` back at an already-visited error; the chain is walked with a cap
// rather than a seen-set because the depth of real wrapper chains is 2-3.
const MAX_CAUSE_DEPTH = 5;

// eslint-disable-next-line lingui/no-unlocalized-strings -- Error.name identifiers, never user-facing
const ABORT_ERROR_NAMES = new Set(['AbortError', 'CancelledError']);

const CHUNK_LOAD_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
];

// `TRPCClientError.from` wraps the original error and sets `name = 'TRPCClientError'`, so a
// `name`-only check never matches a cancelled/aborted request wrapped by it — the original
// AbortError/CancelledError is stored in `cause` instead.
const isAbortLikeError = (error: unknown, depth = 0): boolean => {
  if (depth > MAX_CAUSE_DEPTH || !(error instanceof Error)) {
    return false;
  }
  if (ABORT_ERROR_NAMES.has(error.name)) {
    return true;
  }
  return isAbortLikeError(error.cause, depth + 1);
};

/**
 * `false` when the error is not reportable: not an `Error`, it carries a tRPC `data` payload
 * (the backend already answered and logged it), or it is a cancellation/abort (including one
 * wrapped by `TRPCClientError`). `true` otherwise.
 */
export const isReportableError = (error: Error): boolean => {
  if ('data' in error && (error.data !== undefined && error.data !== null)) {
    return false;
  }
  return !isAbortLikeError(error);
};

export const isChunkLoadError = (error: Error): boolean => (
  CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => pattern.test(error.message))
);

/**
 * A chunk-load failure is classified by message content rather than by the path it arrived on:
 * it can surface from the render, route or transport path, and must always report the same kind.
 */
export const resolveErrorKind = (error: Error, pathKind: ClientErrorKind): ClientErrorKind => (
  isChunkLoadError(error) ? 'chunk' : pathKind
);

/**
 * Reduces `navStore.getLogs()` to the bounded, serializable shape the report carries: the current
 * location plus the router event types, hard-capped at the length the backend schema accepts.
 */
export const projectNavigationHistory = (logs: NavigationLogs): string => {
  const events = logs.routerEvents.flatMap((entry) => (
    entry ? entry.times.map((time) => ({ type: time.type, href: entry.routerEvent.toLocation.href })) : []
  ));
  return JSON.stringify({ to: logs.to, events }).slice(0, MAX_NAVIGATION_HISTORY_LENGTH);
};

/**
 * Dedup key for the report queue. A plain `kind|message` concatenation: with no per-operation
 * field in the payload, a whole `httpBatchLink` outage collapses naturally under one signature.
 */
export const buildReportSignature = (report: ClientErrorReport): string => `${report.kind}|${report.message}`;
