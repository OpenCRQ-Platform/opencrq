import { sanitizeStixNullBytes } from '@app/module/stix-sanitize';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AppModule from '@app/module';

// ── Fake mirror (in-memory stand-in for the opencti_stream_objects table) ──────────────

interface FakeMirrorRow {
  tenantId: string,
  stixId: string,
  stixType: string,
  sourceRef: string | null,
  targetRef: string | null,
  relationshipType: string | null,
  createdByRef: string | null,
  data: Record<string, unknown>,
  deletedAt: Date | null,
  pending: boolean,
}

// Postgres refuses U+0000 in a `text` value as in a `jsonb` one, and the consumer reads that
// rejection as a failed connection: the table stands in for that refusal, not just for the storage.
// Walked rather than searched in the serialised form, where a value spelling out the six-character
// escape is indistinguishable from the byte itself, and Postgres stores that text happily.
const rejectsNullByte = (node: unknown): boolean => {
  if (typeof node === 'string') {
    return node.includes('\u0000');
  }
  if (Array.isArray(node)) {
    return node.some((item: unknown) => rejectsNullByte(item));
  }
  if (typeof node === 'object' && node !== null) {
    return Object.entries(node).some(([key, value]) => key.includes('\u0000') || rejectsNullByte(value));
  }
  return false;
};

const createFakeMirror = () => {
  const rows = new Map<string, FakeMirrorRow>();
  const key = (tenantId: string, stixId: string): string => `${tenantId}|${stixId}`;

  const upsertStreamObject = (tenantId: string, stixId: string, stixType: string, data: Record<string, unknown>): Promise<void> => {
    if (rejectsNullByte(stixId) || rejectsNullByte(stixType) || rejectsNullByte(data)) {
      return Promise.reject(new Error('unsupported Unicode escape sequence'));
    }
    const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    const existing = rows.get(key(tenantId, stixId));
    // The `setWhere` of the real upsert: an identical payload on a live row writes nothing at all.
    if (existing && existing.deletedAt === null && JSON.stringify(existing.data) === JSON.stringify(data)) {
      return Promise.resolve();
    }
    rows.set(key(tenantId, stixId), {
      tenantId,
      stixId,
      stixType,
      sourceRef: stixType === 'relationship' ? asString(data['source_ref']) : null,
      targetRef: stixType === 'relationship' ? asString(data['target_ref']) : null,
      relationshipType: stixType === 'relationship' ? asString(data['relationship_type']) : null,
      createdByRef: asString(data['created_by_ref']),
      data,
      deletedAt: null,
      pending: true,
    });
    return Promise.resolve();
  };

  // Tombstones the id and, as the real statement does, every live row holding it at either end.
  const deleteStreamObject = (tenantId: string, stixId: string): Promise<void> => {
    if (rejectsNullByte(stixId)) {
      return Promise.reject(new Error('unsupported Unicode escape sequence'));
    }
    for (const row of rows.values()) {
      const hit = row.stixId === stixId || row.sourceRef === stixId || row.targetRef === stixId;
      if (row.tenantId === tenantId && hit && row.deletedAt === null) {
        rows.set(key(tenantId, row.stixId), { ...row, deletedAt: new Date(), pending: true });
      }
    }
    return Promise.resolve();
  };

  const repointStreamObjectRefs = (tenantId: string, fromStixId: string, toStixId: string): Promise<void> => {
    for (const row of rows.values()) {
      if (row.tenantId !== tenantId) {
        continue;
      }
      if (row.sourceRef === fromStixId) {
        row.sourceRef = toStixId;
        row.data = { ...row.data, source_ref: toStixId };
        row.pending = true;
      }
      if (row.targetRef === fromStixId) {
        row.targetRef = toStixId;
        row.data = { ...row.data, target_ref: toStixId };
        row.pending = true;
      }
      if (row.createdByRef === fromStixId) {
        row.createdByRef = toStixId;
        row.data = { ...row.data, created_by_ref: toStixId };
        row.pending = true;
      }
    }
    return Promise.resolve();
  };

  return {
    upsertStreamObject,
    deleteStreamObject,
    repointStreamObjectRefs,
    row: (tenantId: string, stixId: string): FakeMirrorRow | undefined => rows.get(key(tenantId, stixId)),
    all: (tenantId: string): Array<FakeMirrorRow> => [...rows.values()].filter((row) => row.tenantId === tenantId),
    reset: (): void => rows.clear(),
  };
};

const fakeMirror = createFakeMirror();

// ── Stubs ────────────────────────────────────────────────────────────────────────────

const mockGetSettings = vi.fn();
const mockFindAllEnabled = vi.fn();
// Stands in for the service, its own sanitising guard included, so what the manager hands over is
// held to what the real write would accept.
const mockUpsertStreamObject = vi.fn(async (tenantId: string, stixId: string, stixType: string, data: Record<string, unknown>) => {
  const { data: sanitized, changedStrings, droppedKeys } = sanitizeStixNullBytes(data);
  await fakeMirror.upsertStreamObject(tenantId, stixId, stixType, sanitized);
  return { changedStrings, droppedKeys };
});
const mockDeleteStreamObject = vi.fn(fakeMirror.deleteStreamObject);
const mockRepointStreamObjectRefs = vi.fn(fakeMirror.repointStreamObjectRefs);
const mockUpdateCursor = vi.fn();
// What the guarded update leaves in the row: the latch is a coalesce and the total a sum.
const acceptCursorWrites = (startingLatch: Date | null = null): void => {
  let latch = startingLatch;
  let total = 0;
  mockUpdateCursor.mockImplementation((_tenantId: string, _cursor: string, _at: Date, candidate: Date | null, read: number) => {
    latch = latch ?? candidate;
    total += read;
    return Promise.resolve({ reachedLiveTailAt: latch, objectsRead: total });
  });
};
const mockSetEnabled = vi.fn();
const mockMarkAuthFailed = vi.fn();
const mockGetServiceAccount = vi.fn();

const mockWithOrigin = vi.fn().mockReturnValue({
  openctiConnector: {
    getSettings: mockGetSettings,
    findAllEnabled: mockFindAllEnabled,
    upsertStreamObject: mockUpsertStreamObject,
    deleteStreamObject: mockDeleteStreamObject,
    repointStreamObjectRefs: mockRepointStreamObjectRefs,
    updateCursor: mockUpdateCursor,
    setEnabled: mockSetEnabled,
    markAuthFailed: mockMarkAuthFailed,
  },
  serviceAccounts: {
    getServiceAccount: mockGetServiceAccount,
  },
});

vi.mock('@app/module', async () => ({
  ...await vi.importActual<typeof AppModule>('@app/module'),
  allServiceDefinitions: [],
  createServices: vi.fn().mockReturnValue({ withOrigin: mockWithOrigin }),
}));

let connectorsConfig: Record<string, unknown> = {
  opencti: {
    'tenant-a': { url: 'https://opencti.example.com', token: 'tok' },
    'tenant-b': { url: 'https://opencti.example.com', token: 'tok' },
  },
};
vi.mock('../../config', () => ({
  config: vi.fn(() => ({ connectors: connectorsConfig })),
}));

vi.mock('../../engines/db', () => ({
  dbEngine: { db: {} },
}));

const mockLogTrace = vi.fn();
vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    logTrace: mockLogTrace,
    logFromError: vi.fn(),
  }),
}));

const mockStartPgListenLoop = vi.fn().mockResolvedValue(undefined);
vi.mock('../../utils/pg-listen-loop', () => ({
  startPgListenLoop: mockStartPgListenLoop,
}));

const mockConsumeOpenCtiStream = vi.fn();
class MockOpenCtiStreamFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenCtiStreamFatalError';
  }
}
class MockOpenCtiAuthError extends MockOpenCtiStreamFatalError {
  constructor(message: string) {
    super(message);
    this.name = 'OpenCtiAuthError';
  }
}
vi.mock('./opencti-sse-client', () => ({
  consumeOpenCtiStream: mockConsumeOpenCtiStream,
  OpenCtiAuthError: MockOpenCtiAuthError,
  OpenCtiStreamFatalError: MockOpenCtiStreamFatalError,
}));

// Real `sleep` (not mocked): its abort-cancels-the-timer behaviour is what keeps
// `runConsumerLoop`'s retry-after-disconnect loop from spinning tightly — each test aborts its
// controller in `afterEach`, which resolves any pending `sleep` immediately instead of the loop
// either genuinely waiting out the reconnect backoff or (if mocked to resolve instantly) spinning
// an unbounded tight loop between test setup and assertions.

const { startAll } = await import('./opencti-connector-manager');

// ── Helpers ──────────────────────────────────────────────────────────────────────────

const baseSettings = {
  enabled: true,
  streamId: 'live-stream-1',
  serviceAccountId: 'sa-1',
  streamGeneration: 0,
  cursor: null as string | null,
  lastEventAt: null as Date | null,
  reachedLiveTailAt: null as Date | null,
};

const stixThreat = { id: 'intrusion-set--1', type: 'intrusion-set', name: 'Group A' };
const irrelevantReport = { id: 'report--1', type: 'report', name: 'Some Report' };

const createEvent = (id: string, event: string, stixObject: Record<string, unknown>) => ({
  id,
  event,
  data: { data: stixObject },
});

const createMergeEvent = (id: string, survivor: Record<string, unknown>, sources: Array<Record<string, unknown>>) => ({
  id,
  event: 'merge',
  data: { data: survivor, context: { sources } },
});

const createPatchedEvent = (id: string, type: string, stixObject: Record<string, unknown>, reversePatch: unknown) => ({
  id,
  event: type,
  data: { data: stixObject, context: { reverse_patch: reversePatch } },
});

interface FakeStreamEvent {
  id: string,
  event: string,
  data: unknown,
}

/**
 * Fake async generator standing in for `consumeOpenCtiStream`: yields a fixed sequence, then
 * hangs (like a real still-open connection) until the signal aborts, instead of returning —
 * returning would make `runConsumerLoop` immediately retry-and-reconnect via the same mock again,
 * which is not what most tests want to exercise. Omitting the signal asks for exactly that return,
 * the only thing that drives `runConsumerLoop` to reconnect.
 */
const fakeStream = (events: Array<FakeStreamEvent>, signal?: AbortSignal) => (async function* streamGenerator() {
  for (const event of events) {
    yield event;
  }
  if (!signal) {
    return;
  }
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
})();

describe('opencti-connector-manager', () => {
  let controller: AbortController;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeMirror.reset();
    controller = new AbortController();
    connectorsConfig = {
      opencti: {
        'tenant-a': { url: 'https://opencti.example.com', token: 'tok' },
        'tenant-b': { url: 'https://opencti.example.com', token: 'tok' },
      },
    };
    // Sensible default: one enabled tenant, re-confirmed by `getSettings` — tests that need a
    // different shape (disabled, not configured, several tenants) override one or both.
    mockFindAllEnabled.mockResolvedValue([{ tenantId: 'tenant-a', ...baseSettings }]);
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockGetServiceAccount.mockResolvedValue({ active: true });
    acceptCursorWrites();
    mockStartPgListenLoop.mockImplementation((options: { onListening?: () => void }) => {
      options.onListening?.();
      return Promise.resolve();
    });
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  it('starts a consumer for every tenant with enabled=true at boot', async () => {
    mockFindAllEnabled.mockResolvedValue([{ tenantId: 'tenant-a', ...baseSettings }]);
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockConsumeOpenCtiStream).toHaveBeenCalledWith(
      expect.objectContaining({ streamId: 'live-stream-1' }),
    ));
  });

  it('does not connect (and does not touch the stream/DB) when the configured service account is inactive', async () => {
    mockFindAllEnabled.mockResolvedValue([{ tenantId: 'tenant-a', ...baseSettings }]);
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    // Otherwise silently denied (0 rows, no error) by the tenant security policy under the
    // connector's own origin, rather than actually stopping like a disabled connector does.
    mockGetServiceAccount.mockResolvedValue({ active: false });

    startAll(controller.signal);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockConsumeOpenCtiStream).not.toHaveBeenCalled();
  });

  it('asks for recover when reconnecting before the live tail has been reached, to resume precisely instead of skipping ahead', async () => {
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings, cursor: '1620249512318-0', reachedLiveTailAt: null });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockConsumeOpenCtiStream).toHaveBeenCalledWith(
      expect.objectContaining({ lastEventId: '1620249512318-0', needsRecover: true }),
    ));
  });

  it('does not ask for recover once the live tail has already been reached', async () => {
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings, cursor: '1620249512318-0', reachedLiveTailAt: new Date() });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockConsumeOpenCtiStream).toHaveBeenCalledWith(
      expect.objectContaining({ lastEventId: '1620249512318-0', needsRecover: false }),
    ));
  });

  describe('the lines it writes to the Logs tab', () => {
    const CAUGHT_UP = /^OpenCTI stream caught up with its live edge/;
    const loggedMessages = (): Array<unknown> => mockLogTrace.mock.calls.map(([message]) => message);

    it.each([
      ['no position and the live edge never reached', null, null, 'OpenCTI stream reading from its beginning'],
      ['no position and the live edge already reached', null, new Date(), 'OpenCTI stream starting at its live edge'],
      ['a saved position', '1620249512318-0', null, 'OpenCTI stream resuming after event 1620249512318-0'],
    ])('names where it starts reading from, with %s', async (_, cursor, reachedLiveTailAt, expected) => {
      mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings, cursor, reachedLiveTailAt });
      mockConsumeOpenCtiStream.mockReturnValue(fakeStream([], controller.signal));

      startAll(controller.signal);

      await vi.waitFor(() => expect(mockConsumeOpenCtiStream).toHaveBeenCalled());
      expect(mockLogTrace).toHaveBeenCalledWith(expected, { tenantId: 'tenant-a', streamId: 'live-stream-1' });
    });

    const now = new Date('2026-07-30T10:00:00.000Z');
    const latchedEarlier = new Date('2026-07-30T09:59:00.000Z');
    const caughtUpLines = (): Array<unknown> => loggedMessages().filter((message) => typeof message === 'string' && CAUGHT_UP.test(message));

    /** Two events at the live edge, each flushed on its own. */
    const runTwoFlushes = async (): Promise<void> => {
      let releaseSecondEvent: () => void = () => {};
      const secondEventGate = new Promise<void>((resolve) => {
        releaseSecondEvent = resolve;
      });
      mockConsumeOpenCtiStream.mockReturnValue((async function* twoFlushStream() {
        yield createEvent(`${now.getTime()}-0`, 'create', stixThreat);
        await secondEventGate;
        yield createEvent(`${now.getTime()}-1`, 'create', { ...stixThreat, id: 'intrusion-set--2' });
        await new Promise<void>((resolve) => {
          controller.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      })());

      startAll(controller.signal);
      await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(3_000);
      releaseSecondEvent();
      await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(3_000);
      expect(mockUpdateCursor).toHaveBeenCalledTimes(2);
    };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
    });

    it('says once that a replay reached the live edge, with the total the database holds', async () => {
      mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });

      await runTwoFlushes();

      expect(caughtUpLines()).toEqual(['OpenCTI stream caught up with its live edge after reading 1 object']);
    });

    it.each([
      ['it started at the live edge already', latchedEarlier, () => acceptCursorWrites(latchedEarlier)],
      ['another consumer\'s write set the latch first', null, () => acceptCursorWrites(latchedEarlier)],
      ['the generation guard refused its position', null, () => mockUpdateCursor.mockResolvedValue(null)],
    ])('never says a replay ended when %s', async (_, startingLatch, arrangeWrites) => {
      mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings, reachedLiveTailAt: startingLatch });
      arrangeWrites();

      await runTwoFlushes();

      expect(caughtUpLines()).toEqual([]);
    });

    it('carries a refused write\'s count into the next flush instead of retiring it', async () => {
      mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings, reachedLiveTailAt: latchedEarlier });
      mockUpdateCursor.mockResolvedValueOnce(null);

      await runTwoFlushes();

      expect(mockUpdateCursor.mock.calls.map((call) => call[4])).toEqual([1, 2]);
    });
  });

  it('drops irrelevant STIX types before mirroring, and never flushes for them alone', async () => {
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('1', 'create', irrelevantReport),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockConsumeOpenCtiStream).toHaveBeenCalled());
    // Give any (incorrect) mirroring a chance to happen before asserting its absence.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockUpsertStreamObject).not.toHaveBeenCalled();
  });

  it('mirrors a report that cites a threat, trimmed to what the outcome counter reads', async () => {
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    const report = {
      id: 'report--2', type: 'report', name: 'Intrusion write-up', description: 'Files were encrypted.', labels: ['ransomware'],
      object_refs: ['intrusion-set--1', 'malware--1', 'location--1'], x_opencti_files: [{ name: 'huge.pdf' }],
    };
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([createEvent('1', 'create', report)], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalled());

    const stored = fakeMirror.row('tenant-a', 'report--2')?.data;
    expect(stored?.['object_refs']).toEqual(['intrusion-set--1']);
    expect(stored).not.toHaveProperty('x_opencti_files');
  });

  it('removes from the mirror a report an update leaves citing no threat, so its stale row does not stay', async () => {
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    await fakeMirror.upsertStreamObject('tenant-a', 'report--2', 'report', { id: 'report--2', type: 'report', object_refs: ['intrusion-set--1'] });
    const dropped = { id: 'report--2', type: 'report', name: 'Intrusion write-up', object_refs: ['location--1'] };
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([createEvent('1', 'update', dropped)], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockDeleteStreamObject).toHaveBeenCalledWith('tenant-a', 'report--2'));

    expect(mockUpsertStreamObject).not.toHaveBeenCalled();
    expect(fakeMirror.row('tenant-a', 'report--2')?.deletedAt).not.toBeNull();
  });

  it('removes the id a rename left behind when the same update leaves a report citing no threat', async () => {
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    await fakeMirror.upsertStreamObject('tenant-a', 'report--old', 'report', { id: 'report--old', type: 'report', object_refs: ['intrusion-set--1'] });
    const renamedAndDropped = { id: 'report--new', type: 'report', name: 'Renamed write-up', object_refs: ['location--1'] };
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createPatchedEvent('1', 'update', renamedAndDropped, [{ op: 'replace', path: '/id', value: 'report--old' }]),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockDeleteStreamObject).toHaveBeenCalledWith('tenant-a', 'report--old'));

    expect(mockUpsertStreamObject).not.toHaveBeenCalled();
    expect(mockRepointStreamObjectRefs).not.toHaveBeenCalled();
    expect(fakeMirror.row('tenant-a', 'report--old')?.deletedAt).not.toBeNull();
  });

  it('leaves alone a report that never cited a threat, on a create as on an update of another kind of object', async () => {
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('1', 'create', irrelevantReport),
      createEvent('2', 'update', { id: 'note--1', type: 'note' }),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockConsumeOpenCtiStream).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockUpsertStreamObject).not.toHaveBeenCalled();
    expect(mockDeleteStreamObject).not.toHaveBeenCalled();
  });

  it('counts an object it drops as read, the throughput figure measuring the stream rather than what is kept', async () => {
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('1620249512318-0', 'create', irrelevantReport),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockConsumeOpenCtiStream).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(3_000);

    expect(mockUpsertStreamObject).not.toHaveBeenCalled();
    expect(mockUpdateCursor).toHaveBeenCalledWith('tenant-a', '1620249512318-0', expect.any(Date), null, 1, expect.any(Number));
  });

  it('mirrors a relevant create event, marks it pending and updates the cursor at the idle flush', async () => {
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings, reachedLiveTailAt: new Date() });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('42', 'create', stixThreat),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalledWith(
      'tenant-a', 'intrusion-set--1', 'intrusion-set', stixThreat,
    ));

    await vi.advanceTimersByTimeAsync(3_000);
    expect(fakeMirror.row('tenant-a', 'intrusion-set--1')?.pending).toBe(true);
    expect(mockUpdateCursor).toHaveBeenCalledWith('tenant-a', '42', expect.any(Date), null, 1, expect.any(Number));
  });

  it('persists the cursor date as the event\'s own timestamp, not when it was processed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T10:00:00.000Z'));
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    // 1620249512318 -> 2021-05-05T21:18:32.318Z, nothing like the fake "now" set above.
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('1620249512318-0', 'create', stixThreat),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalled());

    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockUpdateCursor).toHaveBeenCalledWith('tenant-a', '1620249512318-0', new Date('2021-05-05T21:18:32.318Z'), null, expect.any(Number), expect.any(Number));
  });

  it('never lets the persisted timeline date regress, even when a later event\'s own date is earlier', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T10:00:00.000Z'));
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    // The source data isn't strictly ordered — id 2 decodes to an EARLIER date than id 1.
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('1755679603531-0', 'create', { ...stixThreat, id: 'intrusion-set--a' }),
      createEvent('1738214969143-0', 'create', { ...stixThreat, id: 'intrusion-set--b' }),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalledTimes(2));

    await vi.advanceTimersByTimeAsync(3_000);
    // Cursor (id) still advances to the latest event, but the persisted date stays at the max seen.
    expect(mockUpdateCursor).toHaveBeenCalledWith('tenant-a', '1738214969143-0', new Date('2025-08-20T08:46:43.531Z'), null, expect.any(Number), expect.any(Number));
  });

  it('passes a reachedLiveTail candidate once an event\'s own date is close enough to "now"', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-07-30T10:00:00.000Z');
    vi.setSystemTime(now);
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    // This event's id encodes a timestamp equal to the fake "now" itself.
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent(`${now.getTime()}-0`, 'create', stixThreat),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalled());

    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockUpdateCursor).toHaveBeenCalledWith('tenant-a', `${now.getTime()}-0`, now, expect.any(Date), expect.any(Number), expect.any(Number));
  });

  it('tombstones the mirrored object on a delete event, leaving the row for the job to fold', async () => {
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('1', 'delete', stixThreat),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockDeleteStreamObject).toHaveBeenCalledWith('tenant-a', 'intrusion-set--1'));
  });

  it('tombstones the relationships of a deleted object with it, and nothing else', async () => {
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    const producer = { id: 'identity--p', type: 'identity', name: 'Threat Intel' };
    const technique = { id: 'attack-pattern--t1566', type: 'attack-pattern', name: 'Phishing' };
    const uses = {
      id: 'relationship--uses', type: 'relationship', relationship_type: 'uses', source_ref: 'intrusion-set--1', target_ref: 'attack-pattern--t1566', created_by_ref: 'identity--p',
    };
    const targeted = {
      id: 'relationship--targeted', type: 'relationship', relationship_type: 'targets', source_ref: 'intrusion-set--other', target_ref: 'intrusion-set--1',
    };
    const unrelated = {
      id: 'relationship--unrelated', type: 'relationship', relationship_type: 'uses', source_ref: 'intrusion-set--other', target_ref: 'attack-pattern--t1566',
    };
    await fakeMirror.upsertStreamObject('tenant-a', producer.id, 'identity', producer);
    await fakeMirror.upsertStreamObject('tenant-a', stixThreat.id, 'intrusion-set', { ...stixThreat, created_by_ref: producer.id });
    await fakeMirror.upsertStreamObject('tenant-a', technique.id, 'attack-pattern', technique);
    await fakeMirror.upsertStreamObject('tenant-a', uses.id, 'relationship', uses);
    await fakeMirror.upsertStreamObject('tenant-a', targeted.id, 'relationship', targeted);
    await fakeMirror.upsertStreamObject('tenant-a', unrelated.id, 'relationship', unrelated);
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('1', 'delete', stixThreat),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(fakeMirror.row('tenant-a', 'intrusion-set--1')?.deletedAt).not.toBeNull());

    const tombstoned = fakeMirror.all('tenant-a').filter((row) => row.deletedAt !== null).map((row) => row.stixId).sort();
    expect(tombstoned).toEqual(['intrusion-set--1', 'relationship--targeted', 'relationship--uses']);
    expect(fakeMirror.row('tenant-a', 'relationship--uses')?.pending).toBe(true);
    expect(fakeMirror.row('tenant-a', 'identity--p')?.deletedAt).toBeNull();
  });

  it('removes every object a merge absorbed, which no delete event will ever name', async () => {
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    const survivor = { id: 'intrusion-set--survivor', type: 'intrusion-set', name: 'Group A' };
    const absorbed = { id: 'intrusion-set--absorbed', type: 'intrusion-set', name: 'Group A bis' };
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createMergeEvent('1', survivor, [absorbed]),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockDeleteStreamObject).toHaveBeenCalledWith('tenant-a', 'intrusion-set--absorbed'));
    expect(mockUpsertStreamObject).toHaveBeenCalledWith('tenant-a', 'intrusion-set--survivor', 'intrusion-set', survivor);
    expect(mockDeleteStreamObject).not.toHaveBeenCalledWith('tenant-a', 'intrusion-set--survivor');
  });

  it('moves the relationships of an absorbed object onto the survivor before removing it, so the survivor inherits its claims', async () => {
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings, reachedLiveTailAt: new Date() });
    const survivor = { id: 'intrusion-set--survivor', type: 'intrusion-set', name: 'Group A' };
    const absorbed = { id: 'intrusion-set--absorbed', type: 'intrusion-set', name: 'Group A bis' };
    const technique = {
      id: 'attack-pattern--t1566', type: 'attack-pattern', name: 'Phishing',
      external_references: [{ source_name: 'mitre-attack', external_id: 'T1566' }],
    };
    const uses = {
      id: 'relationship--uses', type: 'relationship', relationship_type: 'uses', source_ref: 'intrusion-set--absorbed', target_ref: 'attack-pattern--t1566',
    };
    await fakeMirror.upsertStreamObject('tenant-a', absorbed.id, 'intrusion-set', absorbed);
    await fakeMirror.upsertStreamObject('tenant-a', technique.id, 'attack-pattern', technique);
    await fakeMirror.upsertStreamObject('tenant-a', uses.id, 'relationship', uses);
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createMergeEvent('1738214969143-0', survivor, [absorbed]),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockDeleteStreamObject).toHaveBeenCalledWith('tenant-a', 'intrusion-set--absorbed'));
    expect(mockRepointStreamObjectRefs).toHaveBeenCalledWith('tenant-a', 'intrusion-set--absorbed', 'intrusion-set--survivor');
    expect(mockRepointStreamObjectRefs.mock.invocationCallOrder[0]).toBeLessThan(mockDeleteStreamObject.mock.invocationCallOrder[0] ?? 0);

    await vi.advanceTimersByTimeAsync(3_000);
    // The survivor now holds the edge, marked, and the absorbed actor is a tombstone the job
    // retracts: between them that is everything the rebuild needs to make the merge land.
    const moved = fakeMirror.row('tenant-a', 'relationship--uses');
    expect(moved?.sourceRef).toBe('intrusion-set--survivor');
    expect(moved?.pending).toBe(true);
    expect(fakeMirror.row('tenant-a', 'intrusion-set--absorbed')?.deletedAt).not.toBeNull();
  });

  it('removes an absorbed object of any mirrored shape, not only an intrusion-set', async () => {
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    const survivor = { id: 'attack-pattern--survivor', type: 'attack-pattern', name: 'T1566' };
    const absorbed = { id: 'attack-pattern--absorbed', type: 'attack-pattern', name: 'T1566 bis' };
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createMergeEvent('1', survivor, [absorbed]),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockDeleteStreamObject).toHaveBeenCalledWith('tenant-a', 'attack-pattern--absorbed'));
  });

  it('removes nothing and raises nothing on a merge event whose absorbed list is absent', async () => {
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings, reachedLiveTailAt: new Date() });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      { id: '1738214969143-0', event: 'merge', data: { data: stixThreat } },
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalled());

    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockDeleteStreamObject).not.toHaveBeenCalled();
    expect(mockUpdateCursor).toHaveBeenCalled();
  });

  it('follows a renamed object to its new id: the new one is upserted, then its relationships move, then the old id is tombstoned', async () => {
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings, reachedLiveTailAt: new Date() });
    const former = { id: 'intrusion-set--old', type: 'intrusion-set', name: 'Group A 41' };
    const renamed = { id: 'intrusion-set--new', type: 'intrusion-set', name: 'Group A41' };
    const uses = {
      id: 'relationship--uses', type: 'relationship', relationship_type: 'uses', source_ref: 'intrusion-set--old', target_ref: 'attack-pattern--t1566',
    };
    await fakeMirror.upsertStreamObject('tenant-a', former.id, 'intrusion-set', former);
    await fakeMirror.upsertStreamObject('tenant-a', uses.id, 'relationship', uses);
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createPatchedEvent('1738214969143-0', 'update', renamed, [{ op: 'replace', path: '/id', value: former.id }]),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalledWith('tenant-a', 'intrusion-set--new', 'intrusion-set', renamed));
    expect(mockRepointStreamObjectRefs).toHaveBeenCalledWith('tenant-a', 'intrusion-set--old', 'intrusion-set--new');
    expect(mockDeleteStreamObject).toHaveBeenCalledWith('tenant-a', 'intrusion-set--old');
    // The survivor's row exists before anything is moved onto it, and the retired id is only
    // tombstoned last: the cursor advances whatever happens, so a write failing mid-way has to leave
    // the two actors the stream used to show rather than edges naming a survivor with no row.
    expect(mockUpsertStreamObject.mock.invocationCallOrder[0]).toBeLessThan(mockRepointStreamObjectRefs.mock.invocationCallOrder[0] ?? 0);
    expect(mockRepointStreamObjectRefs.mock.invocationCallOrder[0]).toBeLessThan(mockDeleteStreamObject.mock.invocationCallOrder[0] ?? 0);

    await vi.advanceTimersByTimeAsync(3_000);
    const moved = fakeMirror.row('tenant-a', 'relationship--uses');
    expect(moved?.sourceRef).toBe('intrusion-set--new');
    expect(moved?.data['source_ref']).toBe('intrusion-set--new');
    expect(moved?.pending).toBe(true);
    expect(fakeMirror.row('tenant-a', 'intrusion-set--old')?.deletedAt).not.toBeNull();
  });

  it('re-points and tombstones nothing on an update whose reverse_patch is absent, is not an array, or leaves /id alone', async () => {
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings, reachedLiveTailAt: new Date() });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('1738214969143-0', 'update', stixThreat),
      createPatchedEvent('1738214969144-0', 'update', { ...stixThreat, name: 'Group A prime' }, [{ op: 'replace', path: '/name', value: 'Group A' }]),
      createPatchedEvent('1738214969145-0', 'update', { ...stixThreat, confidence: 80 }, { op: 'replace', path: '/id', value: 'intrusion-set--other' }),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalledTimes(3));

    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockRepointStreamObjectRefs).not.toHaveBeenCalled();
    expect(mockDeleteStreamObject).not.toHaveBeenCalled();
  });

  it('re-points and tombstones nothing when the reverse_patch replaces /id with the id the event already carries', async () => {
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings, reachedLiveTailAt: new Date() });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createPatchedEvent('1738214969143-0', 'update', stixThreat, [{ op: 'replace', path: '/id', value: stixThreat.id }]),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalled());

    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockRepointStreamObjectRefs).not.toHaveBeenCalled();
    expect(mockDeleteStreamObject).not.toHaveBeenCalled();
  });

  it('ignores a replace of /id on a create event, only an update announcing a rename', async () => {
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings, reachedLiveTailAt: new Date() });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createPatchedEvent('1738214969143-0', 'create', stixThreat, [{ op: 'replace', path: '/id', value: 'intrusion-set--old' }]),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalled());

    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockRepointStreamObjectRefs).not.toHaveBeenCalled();
    expect(mockDeleteStreamObject).not.toHaveBeenCalled();
  });

  it('mirrors an object carrying a null byte, sanitised, and keeps the connection instead of reconnecting', async () => {
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('1000000000000', 'create', {
        ...stixThreat,
        description: 'Scraped\u0000 report, accents "é", quotes and\ttabs kept',
      }),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalledTimes(1));

    expect(fakeMirror.row('tenant-a', 'intrusion-set--1')?.data['description'])
      .toBe('Scraped report, accents "é", quotes and\ttabs kept');
    expect(mockLogTrace).toHaveBeenCalledWith(
      'OpenCTI stream object sanitised before mirroring',
      { tenantId: 'tenant-a', stixId: 'intrusion-set--1', changedStrings: 1, droppedKeys: 0 },
    );

    // A single connection, before and after the reconnect backoff would have elapsed.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockConsumeOpenCtiStream).toHaveBeenCalledTimes(1);
  });

  it('mirrors an object whose id and type carry a null byte under the stripped id and type', async () => {
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('1000000000000', 'create', { id: 'intrusion-set--1\u0000', type: 'intrusion-set\u0000', name: 'Group A' }),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalledTimes(1));

    // `stix_id` and `stix_type` are text columns, and the type also has to match a known one for the
    // object to be kept at all: both are read stripped, so the object is neither lost nor refused.
    expect(mockUpsertStreamObject).toHaveBeenCalledWith('tenant-a', 'intrusion-set--1', 'intrusion-set', expect.anything());
    expect(fakeMirror.row('tenant-a', 'intrusion-set--1')?.data)
      .toMatchObject({ id: 'intrusion-set--1', type: 'intrusion-set', name: 'Group A' });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockConsumeOpenCtiStream).toHaveBeenCalledTimes(1);
  });

  it('tombstones the mirrored object on a delete event whose id carries a null byte', async () => {
    vi.useFakeTimers();
    await fakeMirror.upsertStreamObject('tenant-a', 'intrusion-set--1', 'intrusion-set', stixThreat);
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('1000000000000', 'delete', { ...stixThreat, id: 'intrusion-set--1\u0000' }),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockDeleteStreamObject).toHaveBeenCalledWith('tenant-a', 'intrusion-set--1'));

    expect(fakeMirror.row('tenant-a', 'intrusion-set--1')?.deletedAt).not.toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockConsumeOpenCtiStream).toHaveBeenCalledTimes(1);
  });

  it('mirrors a relationship whose relationship_type carries a null byte instead of skipping the event', async () => {
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('1000000000000', 'create', {
        id: 'relationship--1',
        type: 'relationship',
        relationship_type: 'uses\u0000',
        source_ref: 'intrusion-set--1',
        target_ref: 'attack-pattern--1',
      }),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalledTimes(1));

    expect(fakeMirror.row('tenant-a', 'relationship--1')?.relationshipType).toBe('uses');
    expect(mockLogTrace).toHaveBeenCalledWith(
      'OpenCTI stream object sanitised before mirroring',
      { tenantId: 'tenant-a', stixId: 'relationship--1', changedStrings: 1, droppedKeys: 0 },
    );

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockConsumeOpenCtiStream).toHaveBeenCalledTimes(1);
  });

  it('mirrors an identity whose identity_class carries a null byte instead of skipping the event', async () => {
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('1000000000000', 'create', { id: 'identity--1', type: 'identity', identity_class: 'organization\u0000', name: 'ACME' }),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalledTimes(1));

    expect(fakeMirror.row('tenant-a', 'identity--1')?.data).toMatchObject({ identity_class: 'organization', name: 'ACME' });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockConsumeOpenCtiStream).toHaveBeenCalledTimes(1);
  });

  it('mirrors a description spelling out the escape sequence unchanged', async () => {
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    const description = 'the literal text \\u0000 is not a null byte';
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('1000000000000', 'create', { ...stixThreat, description }),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalledTimes(1));

    expect(fakeMirror.row('tenant-a', 'intrusion-set--1')?.data['description']).toBe(description);
    expect(mockLogTrace).not.toHaveBeenCalledWith('OpenCTI stream object sanitised before mirroring', expect.anything());

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockConsumeOpenCtiStream).toHaveBeenCalledTimes(1);
  });

  it('marks every object it mirrors mid-backfill, the live tail gating nothing any more', async () => {
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    // Realistic epoch-ms-style ids (far in the past) — a plain loop index like "0"/"1" doesn't
    // parse as a positive epoch in `parseEventTimestamp`, which would leave `lastEventAt` null for
    // the whole burst and skip persisting the cursor entirely (see `persistCursor`).
    const events = Array.from({ length: 500 }, (_, i) => createEvent(`${1_000_000_000_000 + i}`, 'create', { ...stixThreat, id: `intrusion-set--${i}` }));
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream(events, controller.signal));

    startAll(controller.signal);

    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalledTimes(500));
    expect(mockUpdateCursor).toHaveBeenCalledWith('tenant-a', '1000000000499', expect.any(Date), null, 500, expect.any(Number));
    // Every event is from 2001, nowhere near "now", so the live tail is never reached: a tenant
    // with a large history has its backlog marked as it fills rather than at the end of it.
    expect(fakeMirror.all('tenant-a').filter((row) => row.pending)).toHaveLength(500);
  });

  it('forces a flush on what it read, so a busy stream of objects it drops still persists its position', async () => {
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    const events = Array.from({ length: 500 }, (_, i) => createEvent(`${1_000_000_000_000 + i}`, 'create', irrelevantReport));
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream(events, controller.signal));

    startAll(controller.signal);

    // No timer is advanced here on purpose: these events re-arm the idle debounce and none bumps the
    // mirrored-object counter, so the read count is the only thing that can carry this position out.
    await vi.waitFor(() => expect(mockUpdateCursor).toHaveBeenCalledWith(
      'tenant-a', '1000000000499', expect.any(Date), null, 500, expect.any(Number),
    ));
    expect(mockUpsertStreamObject).not.toHaveBeenCalled();
  });

  it('serializes an in-flight idle flush against a subsequent forced flush instead of running them concurrently', async () => {
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings, reachedLiveTailAt: new Date() });

    // The idle flush's own cursor write hangs until manually resolved below, standing in for a slow
    // DB round trip that a later flush could otherwise race past and land an older position after.
    let resolveIdleWrite: () => void = () => {};
    const idleWritePromise = new Promise<{ reachedLiveTailAt: Date | null, objectsRead: number }>((resolve) => {
      resolveIdleWrite = () => resolve({ reachedLiveTailAt: new Date(), objectsRead: 1 });
    });
    mockUpdateCursor.mockImplementationOnce(() => idleWritePromise);

    // Gated so the forced burst is only fed in once the idle flush has actually been triggered —
    // otherwise the ungated generator races ahead of the idle debounce and nothing overlaps.
    let releaseForcedBurst: () => void = () => {};
    const forcedBurstGate = new Promise<void>((resolve) => {
      releaseForcedBurst = resolve;
    });
    // Realistic epoch-ms-style ids (a non-numeric id like 'forced-0' would make `parseEventTimestamp`
    // return null, which now skips persisting the cursor entirely instead of falling back to "now").
    const forcedBurst = Array.from({ length: 500 }, (_, i) => createEvent(`${1_700_000_001_000 + i}`, 'create', { ...stixThreat, id: `intrusion-set--forced-${i}` }));
    const gatedStream = (async function* gatedStreamGenerator() {
      yield createEvent('1700000000000', 'create', { ...stixThreat, id: 'intrusion-set--idle' });
      await forcedBurstGate;
      for (const event of forcedBurst) {
        yield event;
      }
      await new Promise<void>((resolve) => {
        controller.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    })();
    mockConsumeOpenCtiStream.mockReturnValue(gatedStream);

    startAll(controller.signal);

    // The single idle event debounces; advancing past it starts the idle flush, which hangs on
    // its (still-pending) cursor write.
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalledWith('tenant-a', 'intrusion-set--idle', 'intrusion-set', expect.anything()));
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.waitFor(() => expect(mockUpdateCursor).toHaveBeenCalledTimes(1));

    // Real timers from here on: no further debounce timing is needed, and `vi.waitFor`'s own
    // polling can't advance fake timers itself.
    vi.useRealTimers();

    // The 500 forced events are processed and trigger their own flush while the idle flush is
    // still in flight: it must queue behind it, not write its own position concurrently.
    releaseForcedBurst();
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalledTimes(501));
    expect(mockUpdateCursor).toHaveBeenCalledTimes(1);

    // Only once the idle flush's write resolves should the queued one actually run.
    resolveIdleWrite();
    await vi.waitFor(() => expect(mockUpdateCursor).toHaveBeenCalledTimes(2));

    // Cursors persist in the order the flushes were triggered, never an older one after a newer one.
    // Each carries the count read up to its own position, not what arrived while it was in flight.
    expect(mockUpdateCursor.mock.calls[0]).toEqual(['tenant-a', '1700000000000', expect.any(Date), null, 1, expect.any(Number)]);
    expect(mockUpdateCursor.mock.calls[1]).toEqual(['tenant-a', '1700000001499', expect.any(Date), null, 500, expect.any(Number)]);
  });

  it('persists its position once after a small burst goes idle (debounce), not per event', async () => {
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings, reachedLiveTailAt: new Date() });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('1738214969143-0', 'create', { ...stixThreat, id: 'intrusion-set--a' }),
      createEvent('1738214969144-0', 'create', { ...stixThreat, id: 'intrusion-set--b' }),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalledTimes(2));
    expect(mockUpdateCursor).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockUpdateCursor).toHaveBeenCalledTimes(1);
  });

  /**
   * The crash the mark exists to survive: the objects are durably mirrored and marked, and no
   * in-memory set has to reach the database for the job to find them again.
   */
  it('leaves what it mirrored marked when it is retired mid-backfill', async () => {
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('1000000000000', 'create', stixThreat),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalledTimes(1));

    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fakeMirror.row('tenant-a', 'intrusion-set--1')?.pending).toBe(true);
  });

  it('writes nothing on a plain reconnect once already live, with no new events', async () => {
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings, cursor: '1620249512318-0', reachedLiveTailAt: new Date() });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockConsumeOpenCtiStream).toHaveBeenCalledTimes(1));

    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockUpdateCursor).not.toHaveBeenCalled();
    expect(mockUpsertStreamObject).not.toHaveBeenCalled();
  });

  it('does nothing when the tenant settings are disabled', async () => {
    mockFindAllEnabled.mockResolvedValue([{ tenantId: 'tenant-a', ...baseSettings }]);
    mockGetSettings.mockResolvedValue({
      tenantId: 'tenant-a', enabled: false, streamId: null, serviceAccountId: null, cursor: null, lastEventAt: null,
    });

    startAll(controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockConsumeOpenCtiStream).not.toHaveBeenCalled();
  });

  it('does nothing when connectors.opencti has no entry at all', async () => {
    connectorsConfig = {};
    mockFindAllEnabled.mockResolvedValue([{ tenantId: 'tenant-a', ...baseSettings }]);
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });

    startAll(controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockConsumeOpenCtiStream).not.toHaveBeenCalled();
  });

  it('does nothing for a tenant with no matching connectors.opencti entry, even when another tenant has one', async () => {
    connectorsConfig = { opencti: { 'tenant-b': { url: 'https://opencti.example.com', token: 'tok' } } };
    mockFindAllEnabled.mockResolvedValue([{ tenantId: 'tenant-a', ...baseSettings }]);
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockLogTrace).toHaveBeenCalledWith(
      'OpenCTI connector not configured for this tenant, skipping', { tenantId: 'tenant-a' },
    ));

    expect(mockConsumeOpenCtiStream).not.toHaveBeenCalled();
  });

  it('connects using only the requesting tenant\'s own url/token, never another tenant\'s', async () => {
    connectorsConfig = {
      opencti: {
        'tenant-a': { url: 'https://tenant-a.opencti.example.com', token: 'tok-a' },
        'tenant-b': { url: 'https://tenant-b.opencti.example.com', token: 'tok-b' },
      },
    };
    mockFindAllEnabled.mockResolvedValue([{ tenantId: 'tenant-a', ...baseSettings }]);
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([], controller.signal));

    startAll(controller.signal);

    await vi.waitFor(() => expect(mockConsumeOpenCtiStream).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://tenant-a.opencti.example.com', token: 'tok-a' }),
    ));
  });

  it('ignores a heartbeat event entirely: no cursor update, no mirroring', async () => {
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      { id: '1738214969143-0', event: 'heartbeat', data: { data: {} } },
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockConsumeOpenCtiStream).toHaveBeenCalled());

    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockUpdateCursor).not.toHaveBeenCalled();
    expect(mockUpsertStreamObject).not.toHaveBeenCalled();
  });

  it('does not advance the cursor on a connected event either (it has no real id)', async () => {
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      { id: '', event: 'connected', data: { data: {} } },
      { id: '1738214969143-0', event: 'heartbeat', data: { data: {} } },
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockConsumeOpenCtiStream).toHaveBeenCalled());

    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockUpdateCursor).not.toHaveBeenCalled();
  });

  it('does not let a heartbeat mid-backfill falsely signal "reached the live tail", even though its own id is near "now"', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-07-30T10:00:00.000Z');
    vi.setSystemTime(now);
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('1620249512318-0', 'create', stixThreat), // a genuinely old historical event
      { id: `${now.getTime()}-0`, event: 'heartbeat', data: { data: {} } }, // heartbeat's id is real wall-clock "now"
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalled());

    await vi.advanceTimersByTimeAsync(3_000);
    // The persisted cursor/date reflects only the real content event — the heartbeat never moves it.
    expect(mockUpdateCursor).toHaveBeenCalledWith('tenant-a', '1620249512318-0', new Date(1620249512318), null, expect.any(Number), expect.any(Number));
  });

  it('does not let a malformed event id mid-backfill falsely signal "reached the live tail" (caught on review)', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-07-30T10:00:00.000Z');
    vi.setSystemTime(now);
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('1620249512318-0', 'create', stixThreat), // a genuinely old historical event
      createEvent('not-a-valid-id', 'create', { ...stixThreat, id: 'intrusion-set--malformed' }), // malformed id — still mirrored, just no trustworthy date
      createEvent('1620249512999-0', 'create', { ...stixThreat, id: 'intrusion-set--later' }), // a later, still-old historical event
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalledTimes(3));

    await vi.advanceTimersByTimeAsync(3_000);
    // No event is lost (all 3 are mirrored, including the malformed-id one, whose own id still
    // advances the cursor) — but the persisted date stays at the latest REAL historical date, and
    // the live-tail latch is correctly not tripped by the malformed id's fallback.
    expect(mockUpdateCursor).toHaveBeenCalledWith('tenant-a', '1620249512999-0', new Date(1620249512999), null, expect.any(Number), expect.any(Number));
  });

  it('never persists a cursor while every event received so far has an unparseable id', async () => {
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([
      createEvent('not-a-valid-id', 'create', stixThreat),
    ], controller.signal));

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockUpsertStreamObject).toHaveBeenCalled());

    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockUpdateCursor).not.toHaveBeenCalled();
  });

  it('persists enabled=false when the SSE connection fails with an OpenCTI auth error, instead of only stopping in-memory', async () => {
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockImplementation(() => {
      throw new MockOpenCtiAuthError('OpenCTI stream auth error (401)');
    });

    startAll(controller.signal);

    await vi.waitFor(() => expect(mockMarkAuthFailed).toHaveBeenCalledWith('tenant-a'));
    // Genuinely stopped, not just logged — no further reconnect attempt follows the disable.
    expect(mockConsumeOpenCtiStream).toHaveBeenCalledTimes(1);
  });

  it('stops (without reconnecting) on a non-auth OpenCtiStreamFatalError, e.g. a stream-reported config error', async () => {
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockImplementation(() => {
      throw new MockOpenCtiStreamFatalError('OpenCTI stream reported an error: Recovery mode is only possible with a start date.');
    });

    startAll(controller.signal);

    await vi.waitFor(() => expect(mockConsumeOpenCtiStream).toHaveBeenCalledTimes(1));
    // Not an auth failure — no persisted disable, just stopped in-memory (no reconnect attempt).
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockMarkAuthFailed).not.toHaveBeenCalled();
    expect(mockConsumeOpenCtiStream).toHaveBeenCalledTimes(1);
  });

  it('starts a new tenant consumer when opencti_config_changed notifies it became enabled', async () => {
    mockFindAllEnabled.mockResolvedValue([{ tenantId: 'tenant-a', ...baseSettings }]);
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([], controller.signal));

    let onNotify: ((tenantId: string) => void) | undefined;
    mockStartPgListenLoop.mockImplementation((options: { onListening?: () => void, onNotify?: (tenantId: string) => void }) => {
      onNotify = options.onNotify;
      options.onListening?.();
      return Promise.resolve();
    });

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockConsumeOpenCtiStream).toHaveBeenCalledTimes(1));

    // A second tenant is configured+enabled after boot; the NOTIFY-driven reconcile should read
    // its settings and start a consumer for it too, without touching tenant-a's.
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-b', ...baseSettings, streamId: 'live-stream-2' });
    onNotify?.('tenant-b');

    await vi.waitFor(() => expect(mockConsumeOpenCtiStream).toHaveBeenCalledWith(
      expect.objectContaining({ streamId: 'live-stream-2' }),
    ));
    expect(mockConsumeOpenCtiStream).toHaveBeenCalledTimes(2);
  });

  it('stops a tenant consumer when opencti_config_changed notifies it became disabled', async () => {
    mockFindAllEnabled.mockResolvedValue([{ tenantId: 'tenant-a', ...baseSettings }]);
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([], controller.signal));

    let onNotify: ((tenantId: string) => void) | undefined;
    mockStartPgListenLoop.mockImplementation((options: { onListening?: () => void, onNotify?: (tenantId: string) => void }) => {
      onNotify = options.onNotify;
      options.onListening?.();
      return Promise.resolve();
    });

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockConsumeOpenCtiStream).toHaveBeenCalledTimes(1));

    mockGetSettings.mockResolvedValue({
      tenantId: 'tenant-a', enabled: false, streamId: null, serviceAccountId: null, cursor: null, lastEventAt: null,
    });
    onNotify?.('tenant-a');

    // Reconcile stops the old consumer and (since disabled) does not start a replacement — the
    // stream consumer is invoked only once, from the initial boot.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockConsumeOpenCtiStream).toHaveBeenCalledTimes(1);
  });

  it('stops a tenant consumer when opencti_config_changed notifies that its service account was deactivated (enabled still true)', async () => {
    mockFindAllEnabled.mockResolvedValue([{ tenantId: 'tenant-a', ...baseSettings }]);
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });
    mockConsumeOpenCtiStream.mockReturnValue(fakeStream([], controller.signal));

    let onNotify: ((tenantId: string) => void) | undefined;
    mockStartPgListenLoop.mockImplementation((options: { onListening?: () => void, onNotify?: (tenantId: string) => void }) => {
      onNotify = options.onNotify;
      options.onListening?.();
      return Promise.resolve();
    });

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockConsumeOpenCtiStream).toHaveBeenCalledTimes(1));

    // Settings themselves are untouched (still enabled) — only the referenced service account
    // flipped inactive, via the `service_accounts_notify_opencti_config_changed` trigger.
    mockGetServiceAccount.mockResolvedValue({ active: false });
    onNotify?.('tenant-a');

    // Reconcile stops the old consumer and does not start a replacement (the account is inactive)
    // — no wasted restart-then-immediately-noop cycle: a restart would call `getSettings`/
    // `getServiceAccount` a 3rd time (once more from the new consumer's own check).
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockConsumeOpenCtiStream).toHaveBeenCalledTimes(1);
    expect(mockGetSettings).toHaveBeenCalledTimes(2);
    expect(mockGetServiceAccount).toHaveBeenCalledTimes(2);
  });

  it('stops a stale tenant consumer that was disabled while the LISTEN connection was down, once reconciled on the next connect', async () => {
    mockFindAllEnabled.mockResolvedValue([{ tenantId: 'tenant-a', ...baseSettings }]);
    mockGetSettings.mockResolvedValue({ tenantId: 'tenant-a', ...baseSettings });

    let capturedSignal: AbortSignal | undefined;
    mockConsumeOpenCtiStream.mockImplementation((options: { signal: AbortSignal }) => {
      capturedSignal = options.signal;
      return fakeStream([], options.signal);
    });

    let onListening: (() => void) | undefined;
    mockStartPgListenLoop.mockImplementation((options: { onListening?: () => void }) => {
      onListening = options.onListening;
      options.onListening?.();
      return Promise.resolve();
    });

    startAll(controller.signal);
    await vi.waitFor(() => expect(mockConsumeOpenCtiStream).toHaveBeenCalledTimes(1));
    expect(capturedSignal?.aborted).toBe(false);

    // Tenant-a got disabled while the LISTEN connection was down, so the opencti_config_changed
    // NOTIFY for it was dropped (see `startPgListenLoop`'s `onListening` doc comment) — only the
    // next reconnect's `onListening`, which re-reads the full enabled set, can catch this.
    mockFindAllEnabled.mockResolvedValue([]);
    onListening?.();

    await vi.waitFor(() => expect(capturedSignal?.aborted).toBe(true));
  });
});
