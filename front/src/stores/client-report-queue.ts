import { CLIENT_ERROR_REPORT_LIMITS } from '@app/module/client';
import type { ClientErrorKind, ClientErrorReport } from '@app/module/client';
import { getCommittedTenantId } from '../lib/tenant-accessor';
import {
  buildReportSignature,
  isReportableError,
  logClientErrorToConsole,
  projectNavigationHistory,
  resolveErrorKind,
} from '../utils';
import { navStore } from './navigation-store';

const MAX_QUEUED_REPORTS = CLIENT_ERROR_REPORT_LIMITS.maxReportsPerBatch;
const MAX_OCCURRENCES = CLIENT_ERROR_REPORT_LIMITS.maxOccurrences;

// Failures reach the cache callbacks spread over React Query's retry backoff and the 5s
// health-check poll, each in its own timer macrotask, so the window has to outlast both to
// aggregate one outage into one report. A successful query flushes immediately regardless.
const FLUSH_DEBOUNCE_MS = 10_000;

let reports: Array<ClientErrorReport> = [];
let isFlushing = false;
let flushHandle: ReturnType<typeof setTimeout> | null = null;

// Callers type the error as `Error`, but React and TanStack Router forward whatever was thrown
// without validating it — an unguarded property read here would throw inside an error handler.
const asReportableError = (error: unknown): Error | undefined => (
  error instanceof Error && isReportableError(error) ? error : undefined
);

const buildReport = (
  error: Error,
  pathKind: ClientErrorKind,
  componentStack?: string | null,
  navigationHistory?: string,
): ClientErrorReport => {
  const now = new Date().toISOString();
  return {
    kind: resolveErrorKind(error, pathKind),
    message: error.message.slice(0, CLIENT_ERROR_REPORT_LIMITS.maxMessageLength),
    stack: error.stack?.slice(0, CLIENT_ERROR_REPORT_LIMITS.maxStackLength),
    componentStack: componentStack?.slice(0, CLIENT_ERROR_REPORT_LIMITS.maxStackLength),
    navigationHistory: navigationHistory?.slice(0, CLIENT_ERROR_REPORT_LIMITS.maxNavigationHistoryLength),
    occurrences: 1,
    firstSeen: now,
    lastSeen: now,
  };
};

const scheduleFlush = (): void => {
  if (flushHandle !== null) {
    return;
  }
  flushHandle = setTimeout(() => {
    flushHandle = null;
    void flush();
  }, FLUSH_DEBOUNCE_MS);
};

const enqueue = (report: ClientErrorReport): void => {
  if (!navigator.onLine) {
    return;
  }

  const signature = buildReportSignature(report);
  const existingIndex = reports.findIndex((queued) => buildReportSignature(queued) === signature);
  if (existingIndex === -1) {
    reports = [...reports, report].slice(-MAX_QUEUED_REPORTS);
  } else {
    const existing = reports[existingIndex];
    reports[existingIndex] = {
      ...existing,
      occurrences: Math.min(existing.occurrences + report.occurrences, MAX_OCCURRENCES),
      lastSeen: report.lastSeen,
    };
  }

  scheduleFlush();
};

// Merges reports drained for a failed send back with anything that arrived mid-flight, capped
// and deduped the same way `enqueue` is, so a repeated outage cannot grow the buffer unbounded.
const requeueBatch = (batch: Array<ClientErrorReport>): void => {
  const merged = [...batch];
  for (const report of reports) {
    const signature = buildReportSignature(report);
    const existingIndex = merged.findIndex((queued) => buildReportSignature(queued) === signature);
    if (existingIndex === -1) {
      merged.push(report);
      continue;
    }
    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...existing,
      occurrences: Math.min(existing.occurrences + report.occurrences, MAX_OCCURRENCES),
      lastSeen: report.lastSeen > existing.lastSeen ? report.lastSeen : existing.lastSeen,
    };
  }
  reports = merged.slice(-MAX_QUEUED_REPORTS);
};

const flush = async (options?: { keepalive?: boolean }): Promise<void> => {
  if (reports.length === 0 || isFlushing) {
    return;
  }
  if (flushHandle !== null) {
    clearTimeout(flushHandle);
    flushHandle = null;
  }

  isFlushing = true;
  const batch = reports;
  reports = [];
  let succeeded = false;

  try {
    const tenantId = getCommittedTenantId();
    const response = await fetch('/api/errors', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: options?.keepalive,
      headers: {
        'Content-Type': 'application/json',
        ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
      },
      body: JSON.stringify({ reports: batch }),
    });

    // A 4xx (including 429) is dropped: the payload will never be accepted, or the server is
    // shedding load, so retrying is pointless either way. Only a 5xx is worth keeping.
    if (response.ok) {
      succeeded = true;
    } else if (response.status >= 500) {
      requeueBatch(batch);
    }
  } catch {
    requeueBatch(batch);
  } finally {
    isFlushing = false;
    if (succeeded && reports.length > 0) {
      scheduleFlush();
    }
  }
};

/**
 * Single entry point for every client error path. Non-reportable errors (aborts, and errors the
 * backend already answered and logged) reach neither the console nor the queue.
 */
const reportClientError = (error: Error, pathKind: ClientErrorKind, componentStack?: string | null): void => {
  const reportableError = asReportableError(error);
  if (!reportableError) {
    return;
  }
  const logs = navStore.getLogs();
  logClientErrorToConsole(reportableError, componentStack, logs);
  enqueue(buildReport(reportableError, pathKind, componentStack, projectNavigationHistory(logs)));
};

const reset = (): void => {
  reports = [];
  isFlushing = false;
  if (flushHandle !== null) {
    clearTimeout(flushHandle);
    flushHandle = null;
  }
};

export const clientReportQueue = {
  reportClientError,
  flush,
  reset,
};
