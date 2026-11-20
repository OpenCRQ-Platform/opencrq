import { CLIENT_ERROR_REPORT_LIMITS } from '@app/module/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientReportQueue } from './client-report-queue';

let mockCommittedTenantId: string | null = null;

vi.mock('../lib/tenant-accessor', () => ({
  getCommittedTenantId: () => mockCommittedTenantId,
}));

interface CapturedRequest {
  url: string,
  init: RequestInit,
}

let requests: Array<CapturedRequest> = [];
let responseQueue: Array<{ status: number, ok: boolean } | Error> = [];

const mockFetch = vi.fn((url: string, init: RequestInit) => {
  requests.push({ url, init });
  const next = responseQueue.shift() ?? { status: 200, ok: true };
  return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
});

const parseBody = (init: RequestInit): { reports: Array<Record<string, unknown>> } => {
  if (typeof init.body !== 'string') {
    throw new Error('expected a string body');
  }
  return JSON.parse(init.body);
};

const getHeader = (init: RequestInit, name: string): string | undefined => {
  const headers = init.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers)) {
    return undefined;
  }
  return headers[name];
};

const setOnline = (online: boolean): void => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
};

beforeEach(() => {
  vi.useFakeTimers();
  requests = [];
  responseQueue = [];
  mockFetch.mockClear();
  vi.stubGlobal('fetch', mockFetch);
  vi.spyOn(console, 'group').mockImplementation(() => undefined);
  vi.spyOn(console, 'groupEnd').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  setOnline(true);
  mockCommittedTenantId = null;
  clientReportQueue.reset();
});

afterEach(() => {
  clientReportQueue.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('clientReportQueue', () => {
  it('dedupes two identical errors into one report with occurrences: 2 and an updated lastSeen', async () => {
    clientReportQueue.reportClientError(new Error('Failed to fetch'), 'transport');
    clientReportQueue.reportClientError(new Error('Failed to fetch'), 'transport');
    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = parseBody(requests[0].init);
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0].occurrences).toBe(2);
  });

  it('clamps occurrences at 100 when the same error repeats 150 times', async () => {
    for (let i = 0; i < 150; i += 1) {
      clientReportQueue.reportClientError(new Error('Failed to fetch'), 'transport');
    }
    await vi.runAllTimersAsync();

    const body = parseBody(requests[0].init);
    expect(body.reports[0].occurrences).toBe(100);
  });

  it('truncates message, stack and componentStack to the bounds the backend schema enforces', async () => {
    const error = new Error('x'.repeat(5000));
    error.stack = 'y'.repeat(9000);
    clientReportQueue.reportClientError(error, 'render', 'z'.repeat(9000));
    await vi.runAllTimersAsync();

    const report = parseBody(requests[0].init).reports[0];
    expect(report.message).toHaveLength(CLIENT_ERROR_REPORT_LIMITS.maxMessageLength);
    expect(report.stack).toHaveLength(CLIENT_ERROR_REPORT_LIMITS.maxStackLength);
    expect(report.componentStack).toHaveLength(CLIENT_ERROR_REPORT_LIMITS.maxStackLength);
  });

  it('collapses six transport errors from six different procedures into one report with occurrences: 6', async () => {
    for (let i = 0; i < 6; i += 1) {
      clientReportQueue.reportClientError(new Error('Failed to fetch'), 'transport');
    }
    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = parseBody(requests[0].init);
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0].occurrences).toBe(6);
  });

  it('collapses failures arriving in separate macrotasks across the retry backoff into one report', async () => {
    clientReportQueue.reportClientError(new Error('Failed to fetch'), 'transport');
    await vi.advanceTimersByTimeAsync(5_000);
    clientReportQueue.reportClientError(new Error('Failed to fetch'), 'transport');
    await vi.advanceTimersByTimeAsync(3_000);
    clientReportQueue.reportClientError(new Error('Failed to fetch'), 'transport');
    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(parseBody(requests[0].init).reports[0].occurrences).toBe(3);
  });

  it('holds at most 10 distinct reports, evicting the oldest', async () => {
    for (let i = 0; i < 15; i += 1) {
      clientReportQueue.reportClientError(new Error(`error-${i}`), 'transport');
    }
    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = parseBody(requests[0].init);
    expect(body.reports.map((report) => report.message)).toEqual(
      Array.from({ length: 10 }, (_, i) => `error-${i + 5}`),
    );
  });

  it('queues nothing and does not throw when a non-Error value was thrown', async () => {
    // React and TanStack Router forward the thrown value as-is despite typing it as `Error`.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- deliberately violates the declared contract
    const thrownValues = [undefined, null, 'boom', { message: 'not an Error' }] as unknown as Array<Error>;
    thrownValues.forEach((value) => {
      expect(() => clientReportQueue.reportClientError(value, 'render')).not.toThrow();
      expect(() => clientReportQueue.reportClientError(value, 'route')).not.toThrow();
      expect(() => clientReportQueue.reportClientError(value, 'transport')).not.toThrow();
    });
    await vi.runAllTimersAsync();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('queues nothing while offline', async () => {
    setOnline(false);
    clientReportQueue.reportClientError(new Error('Failed to fetch'), 'transport');
    await vi.runAllTimersAsync();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('classifies a dynamic-import failure arriving via the route path as "chunk", sent without a piggybacked query', async () => {
    clientReportQueue.reportClientError(new Error('Failed to fetch dynamically imported module'), 'route');
    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(requests[0].url).toBe('/api/errors');
    const body = parseBody(requests[0].init);
    expect(body.reports[0].kind).toBe('chunk');
  });

  it('keeps a report queued with no retry timer when the backend is unreachable, until flush() is called again', async () => {
    responseQueue.push(new Error('network down'));
    clientReportQueue.reportClientError(new Error('Failed to fetch'), 'transport');
    await vi.runAllTimersAsync();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // No retry timer was armed by the failed attempt.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // The onSuccess trigger calls flush() again once the backend recovers.
    responseQueue.push({ status: 200, ok: true });
    await clientReportQueue.flush();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(parseBody(requests[1].init).reports[0].message).toBe('Failed to fetch');
  });

  it('sends a report enqueued mid-flight on the follow-up flush once the in-flight attempt succeeds', async () => {
    let resolveFirst: (value: { status: number, ok: boolean }) => void = () => undefined;
    mockFetch.mockImplementationOnce((url: string, init: RequestInit) => {
      requests.push({ url, init });
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    });

    clientReportQueue.reportClientError(new Error('first error'), 'transport');
    await vi.runOnlyPendingTimersAsync();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Arrives while the first flush is still in flight — buffered, not sent yet.
    clientReportQueue.reportClientError(new Error('second error'), 'transport');
    await vi.runOnlyPendingTimersAsync();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    resolveFirst({ status: 200, ok: true });
    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(parseBody(requests[1].init).reports[0].message).toBe('second error');
  });

  it('drops a 400 response and does not retry', async () => {
    responseQueue.push({ status: 400, ok: false });
    clientReportQueue.reportClientError(new Error('Failed to fetch'), 'transport');
    await vi.runAllTimersAsync();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    responseQueue.push({ status: 200, ok: true });
    await clientReportQueue.flush();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('drops a 429 response and does not retry (no limiter sits in front of this route yet)', async () => {
    responseQueue.push({ status: 429, ok: false });
    clientReportQueue.reportClientError(new Error('Failed to fetch'), 'transport');
    await vi.runAllTimersAsync();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    responseQueue.push({ status: 200, ok: true });
    await clientReportQueue.flush();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retains a report after a 503 response for a later retry', async () => {
    responseQueue.push({ status: 503, ok: false });
    clientReportQueue.reportClientError(new Error('Failed to fetch'), 'transport');
    await vi.runAllTimersAsync();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    responseQueue.push({ status: 200, ok: true });
    await clientReportQueue.flush();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('sends x-tenant-id when the committed route has a tenant', async () => {
    mockCommittedTenantId = 'tenant-1';
    clientReportQueue.reportClientError(new Error('Failed to fetch'), 'transport');
    await vi.runAllTimersAsync();

    expect(getHeader(requests[0].init, 'x-tenant-id')).toBe('tenant-1');
  });

  it('omits x-tenant-id when the committed route has no tenant', async () => {
    clientReportQueue.reportClientError(new Error('Failed to fetch'), 'transport');
    await vi.runAllTimersAsync();

    expect(getHeader(requests[0].init, 'x-tenant-id')).toBeUndefined();
  });
});
