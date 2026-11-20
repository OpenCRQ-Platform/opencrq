import type { ClientErrorReport } from '@app/module/client';
import { CLIENT_ERROR_REPORT_LIMITS } from '@app/module/client';
import { describe, expect, it } from 'vitest';
import type { NavigationLogs } from '../stores/navigation-store';
import {
  buildReportSignature,
  isChunkLoadError,
  isReportableError,
  projectNavigationHistory,
  resolveErrorKind,
} from './client-error-classifier';

const withData = (message: string, data: unknown): Error => Object.assign(new Error(message), { data });

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- router event fixtures reduced to the fields the projection reads
const asNavigationLogs = (logs: unknown): NavigationLogs => logs as NavigationLogs;

describe('isReportableError', () => {
  it('is false for an error carrying a BAD_REQUEST tRPC payload', () => {
    expect(isReportableError(withData('Bad request', { code: 'BAD_REQUEST' }))).toBe(false);
  });

  it('is false for an error carrying an INTERNAL_SERVER_ERROR tRPC payload', () => {
    expect(isReportableError(withData('Internal error', { code: 'INTERNAL_SERVER_ERROR' }))).toBe(false);
  });

  it('is true for a network failure with no tRPC payload', () => {
    expect(isReportableError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('is false for a bare AbortError', () => {
    const error = Object.assign(new Error('aborted'), { name: 'AbortError' });

    expect(isReportableError(error)).toBe(false);
  });

  it('is false for a TRPCClientError wrapping an AbortError in its cause', () => {
    // TRPCClientError.from sets name = 'TRPCClientError' and stores the original in `cause` —
    // this is the case a `name`-only check gets wrong.
    const error = Object.assign(new Error('The operation was aborted'), {
      name: 'TRPCClientError',
      cause: Object.assign(new Error('aborted'), { name: 'AbortError' }),
    });

    expect(isReportableError(error)).toBe(false);
  });

  it('terminates on a self-referencing cause chain', () => {
    const error = new Error('wrapped');
    error.cause = error;

    expect(isReportableError(error)).toBe(true);
  });
});

describe('isChunkLoadError', () => {
  it('matches "Failed to fetch dynamically imported module"', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module'))).toBe(true);
  });

  it('matches "Importing a module script failed"', () => {
    expect(isChunkLoadError(new Error('Importing a module script failed'))).toBe(true);
  });

  it('matches "error loading dynamically imported module" case-insensitively', () => {
    expect(isChunkLoadError(new Error('ERROR LOADING DYNAMICALLY IMPORTED MODULE'))).toBe(true);
  });

  it('does not match a generic error', () => {
    expect(isChunkLoadError(new Error('Network request failed'))).toBe(false);
  });
});

describe('resolveErrorKind', () => {
  it('returns "chunk" for a dynamic-import failure arriving on the route path', () => {
    const error = new Error('Failed to fetch dynamically imported module');

    expect(resolveErrorKind(error, 'route')).toBe('chunk');
  });

  it('returns the path kind for a generic error', () => {
    const error = new Error('Network request failed');

    expect(resolveErrorKind(error, 'route')).toBe('route');
  });
});

describe('projectNavigationHistory', () => {
  it('returns a bounded string for a realistic navStore.getLogs() payload', () => {
    const logs = asNavigationLogs({
      routerEvents: [
        {
          times: [
            { type: 'onBeforeNavigate', start: 1 },
            { type: 'onBeforeLoad', start: 2 },
          ],
          routerEvent: { toLocation: { href: 'https://example.test/foo' } },
        },
      ],
      to: 'https://example.test/bar',
      date: 123,
    });

    expect(JSON.parse(projectNavigationHistory(logs))).toEqual({
      to: 'https://example.test/bar',
      events: [
        { type: 'onBeforeNavigate', href: 'https://example.test/foo' },
        { type: 'onBeforeLoad', href: 'https://example.test/foo' },
      ],
    });
  });

  it('tolerates undefined holes in routerEvents', () => {
    const logs = asNavigationLogs({ routerEvents: [undefined, undefined], to: 'https://example.test', date: 1 });

    expect(JSON.parse(projectNavigationHistory(logs))).toEqual({ to: 'https://example.test', events: [] });
  });

  it('caps the projection at the length the backend schema accepts', () => {
    const logs = asNavigationLogs({
      routerEvents: Array.from({ length: 200 }, () => ({
        times: [{ type: 'onBeforeNavigate', start: 1 }],
        routerEvent: { toLocation: { href: `https://example.test/${'x'.repeat(100)}` } },
      })),
      to: 'https://example.test',
      date: 1,
    });

    expect(projectNavigationHistory(logs)).toHaveLength(CLIENT_ERROR_REPORT_LIMITS.maxNavigationHistoryLength);
  });
});

describe('buildReportSignature', () => {
  const baseReport: ClientErrorReport = {
    kind: 'transport',
    message: 'Failed to fetch',
    occurrences: 1,
    firstSeen: '2026-07-30T10:00:00.000Z',
    lastSeen: '2026-07-30T10:00:00.000Z',
  };

  it('collapses two errors differing only by timestamp', () => {
    const later: ClientErrorReport = {
      ...baseReport,
      firstSeen: '2026-07-30T11:00:00.000Z',
      lastSeen: '2026-07-30T11:00:05.000Z',
    };

    expect(buildReportSignature(baseReport)).toBe(buildReportSignature(later));
  });

  it('separates two reports with the same message but a different kind', () => {
    const routeReport: ClientErrorReport = { ...baseReport, kind: 'route' };

    expect(buildReportSignature(baseReport)).not.toBe(buildReportSignature(routeReport));
  });
});
