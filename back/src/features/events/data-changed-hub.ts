import { EventEmitter, on } from 'node:events';

// Throttle key for tenant-less (global) notifications; a tenant id is a uuid so it cannot collide.
const GLOBAL_SCOPE = '__all__';
const DATA_CHANGED_EVENT = 'data_changed';

/** The table of a doorbell that stands for every table: a LISTEN reconnect, whose missed notifications nobody can name. */
export const EVERY_TABLE = '*';

// null = a global/non-tenant table changed
export interface DataChangedSignal {
  tenantId: string | null,
  // The tables written during the throttle window, or [EVERY_TABLE] alone.
  tables: Array<string>,
}

export interface DataChangedHubOptions {
  // Window for a write nobody tagged, or a job run downstream of one bounded, real-world cause.
  windowMs: number,
  // Window for a sweep with no such bound (a full-estate backfill, a scheduled recompute). Coarse
  // on purpose: it writes for minutes and each doorbell costs every open tab its whole tRPC cache.
  jobWindowMs: number,
}

export interface DataChangedHub {
  // null reaches every subscriber (global tables); a tenant id reaches only subscribers that listed it.
  // `origin` is the job kind whose run produced the write, null when a user wrote. `interactive`
  // says whether anybody is waiting on that run, and picks the window when `origin` is set.
  publish: (tenantId: string | null, origin: string | null, interactive: boolean | null, table: string) => void,
  // Async iterable of doorbells relevant to `tenantIds`, ending when `signal` aborts.
  subscribe: (opts: { tenantIds: ReadonlyArray<string>, signal: AbortSignal }) => AsyncIterable<DataChangedSignal>,
  // Connection-cap bucket: returns false if `key` already holds `max` reservations.
  reserve: (key: string, max: number) => boolean,
  release: (key: string) => void,
  // Register `onRevoke` to fire when `sessionId` is revoked; returns an unwatch fn. Several streams can share one session.
  watchSession: (sessionId: string, onRevoke: () => void) => () => void,
  // Fire every watcher registered for `sessionId` (driven by the session_revoked LISTEN).
  notifySessionRevoked: (sessionId: string) => void,
  // The distinct session ids with at least one live stream: the set to reconcile after a reconnect.
  watchedSessionIds: () => Array<string>,
  // Drop pending throttle timers and detach all subscribers (shutdown/tests).
  closeAll: () => void,
}

export const createDataChangedHub = ({ windowMs, jobWindowMs }: DataChangedHubOptions): DataChangedHub => {
  const emitter = new EventEmitter();
  // One listener per live subscription, no fixed ceiling: disable the warning.
  emitter.setMaxListeners(0);

  const revocations = new EventEmitter();
  revocations.setMaxListeners(0);

  // throttle key (writer class + scope) -> pending throttle timer, and the tables written meanwhile
  const throttleTimers = new Map<string, NodeJS.Timeout>();
  const pendingTables = new Map<string, Set<string>>();
  // cap key (e.g. a user id) -> active reservation count
  const reservations = new Map<string, number>();

  const publish = (tenantId: string | null, origin: string | null, interactive: boolean | null, table: string): void => {
    const scope = tenantId ?? GLOBAL_SCOPE;
    // A run that declared nothing is a run nobody named a waiter for: it keeps the coarse window.
    const awaited = interactive === true;
    // Bucketed by window, not by writer alone: a sweep must not hold an awaited run's change
    // behind its coarse timer. Not by kind on top of that — two sweeps sharing a bucket is what the
    // coarse window is for, and splitting them would ring once per kind sweeping at the same time.
    const key = origin ? `job:${awaited ? 'interactive' : 'batch'}:${scope}` : `user:${scope}`;
    const tables = pendingTables.get(key) ?? new Set<string>();
    if (table === EVERY_TABLE) {
      tables.clear();
    }
    if (!tables.has(EVERY_TABLE)) {
      tables.add(table);
    }
    pendingTables.set(key, tables);
    if (throttleTimers.has(key)) {
      return;
    }
    throttleTimers.set(key, setTimeout(() => {
      throttleTimers.delete(key);
      const written = pendingTables.get(key) ?? new Set([EVERY_TABLE]);
      pendingTables.delete(key);
      const signal: DataChangedSignal = { tenantId, tables: [...written].sort() };
      emitter.emit(DATA_CHANGED_EVENT, signal);
    }, origin && !awaited ? jobWindowMs : windowMs));
  };

  const subscribe = ({ tenantIds, signal }: { tenantIds: ReadonlyArray<string>, signal: AbortSignal }): AsyncIterable<DataChangedSignal> => {
    const allowed = new Set(tenantIds);
    // on() makes the emitter an async iterable and tears its listener down when the signal
    // aborts (the AbortError reads as a normal close to tRPC).
    return (async function* relevantEvents() {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- events.on() returns AsyncIterableIterator<any[]>; typed by contract with our emit call
      for await (const [event] of on(emitter, DATA_CHANGED_EVENT, { signal }) as AsyncIterable<[DataChangedSignal]>) {
        if (event.tenantId === null || allowed.has(event.tenantId)) {
          yield event;
        }
      }
    }());
  };

  const reserve = (key: string, max: number): boolean => {
    const current = reservations.get(key) ?? 0;
    if (current >= max) {
      return false;
    }
    reservations.set(key, current + 1);
    return true;
  };

  const release = (key: string): void => {
    const current = reservations.get(key) ?? 0;
    if (current <= 1) {
      reservations.delete(key);
    } else {
      reservations.set(key, current - 1);
    }
  };

  const watchSession = (sessionId: string, onRevoke: () => void): (() => void) => {
    revocations.on(sessionId, onRevoke);
    return () => {
      revocations.off(sessionId, onRevoke);
    };
  };

  const notifySessionRevoked = (sessionId: string): void => {
    revocations.emit(sessionId);
  };

  // eventNames() are exactly the session ids passed to watchSession (uuid strings); a session drops
  // off once its last stream unwatches.
  const watchedSessionIds = (): Array<string> =>
    revocations.eventNames().filter((name): name is string => typeof name === 'string');

  const closeAll = (): void => {
    for (const timer of throttleTimers.values()) {
      clearTimeout(timer);
    }
    throttleTimers.clear();
    pendingTables.clear();
    reservations.clear();
    revocations.removeAllListeners();
    emitter.removeAllListeners();
  };

  return { publish, subscribe, reserve, release, watchSession, notifySessionRevoked, watchedSessionIds, closeAll };
};
