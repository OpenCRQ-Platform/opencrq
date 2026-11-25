import type { CompletedRunObservation, DoorbellParent, JobDependencyRow, JobObservation } from '@app/module';
import { createDoorbellTopology, SUBSCRIBE_ALL_SENTINEL } from '@app/module';
import { newError } from '@app/utils';
import type { DispatcherAskReason } from '../../utils/recompute-metrics';

export interface DispatchedJob {
  kind: string,
  /** Routes on changes and reconnects. A job registered for its daily hour alone is booked by that alone. */
  observed: boolean,
}

export interface DebounceSettings {
  factor: number,
  floorMs: number,
  capMs: number,
}

export interface DispatcherSettings extends DebounceSettings {
  reconnectMinIntervalMs: number,
}

export interface DataChangedEvent {
  table: string,
  tenantId?: string | null,
  origin?: string | null,
  op?: string | null,
  /** Whether anybody waits on the run that wrote this, `null` when a user wrote it directly. */
  interactive?: boolean | null,
}

export interface NonConvergingCycle {
  kind: string,
  tenantId: string,
  asks: number,
  windowMs: number,
  threshold: number,
  /** The jobs whose writes made the last ask. */
  origins: Array<string>,
  /** Every routed job the asks went through since they last left an outside source, the kind included. */
  chain: Array<string>,
}

export interface DispatcherDeps {
  enqueue: (kind: string, tenantId: string, reason: DispatcherAskReason, interactive: boolean) => Promise<void>,
  loadObservations: () => Promise<Array<JobDependencyRow>>,
  listTenantIds: () => Promise<Array<string>>,
  persistObservation: (kind: string, tenantId: string, observation: JobObservation) => Promise<void>,
  loadDoorbellParents?: () => Promise<Array<DoorbellParent>>,
  /** A pending ask cancelled because the run of the same (kind, tenant) started first. */
  onAskAbsorbed?: (kind: string, tenantId: string, reason: DispatcherAskReason) => void,
  settings: DispatcherSettings,
  onError: (err: unknown, context: string) => void,
  /** A feeding cycle, handed over once per distinct cycle for the life of the dispatcher. */
  onFeedingCycle?: (cycle: Array<string>) => void,
  /** A (kind, tenant) its own writes keep asking for again through other jobs: a cycle that is not converging. */
  onNonConvergingCycle?: (report: NonConvergingCycle) => void,
  now?: () => number,
  setTimer?: (fn: () => void, ms: number) => unknown,
  clearTimer?: (handle: unknown) => void,
}

/**
 * The runtime's own bookkeeping cannot be an input to a domain recompute, and lease renewals
 * update `jobs` every few seconds: routing the subscribe-all state on these would re-enqueue
 * every never-observed job at lease cadence, forever. Explicitly observed sets are not filtered:
 * they route whatever the run genuinely read.
 */
export const RUNTIME_TABLES = new Set(['jobs', 'job_errors', 'job_dependencies', 'job_logs']);

/**
 * Writers whose changes no recompute reads: the retention purge deletes only rows past every reader's
 * window, so routing its deletes would wake a full pass over inputs that did not move.
 */
export const UNROUTED_ORIGINS = new Set(['jobs-retention']);

const key = (kind: string, tenantId: string): string => `${kind}::${tenantId}`;

/**
 * A cycle converges as long as every job in it is watermark-scoped: the one woken by another's
 * write finds nothing stale and writes nothing, so the loop stops of its own accord. One that does
 * not converge shows as a (kind, tenant) asked for again and again by job writes that its own run
 * set off, and this is the window and the count that make it visible in the logs.
 */
const JOB_DRIVEN_ASK_WINDOW_MS = 60_000;
/**
 * Asks are debounce-paced, so the window holds at most `window / delay` of them and a pinned count
 * means something different at each pace — at a 5000ms floor it was out of reach, at 500ms a busy
 * tenant reaches it with no cycle behind it. A third of that ceiling is the share a cycle sustains
 * and ordinary bursts do not, and it reproduces the count this was pinned at when the floor was 1000ms.
 */
const JOB_DRIVEN_ASK_CEILING_SHARE = 3;

export type TableSets = Map<string, Map<string, Set<string>>>;

const unionByKind = (sets: TableSets): Map<string, Set<string>> => {
  const byKind = new Map<string, Set<string>>();
  for (const [kind, tenantSets] of sets) {
    const union = new Set<string>();
    for (const tables of tenantSets.values()) {
      tables.forEach((table) => union.add(table));
    }
    byKind.set(kind, union);
  }
  return byKind;
};

const setTables = (sets: TableSets, kind: string, tenantId: string, tables: Set<string> | undefined): void => {
  let tenantSets = sets.get(kind);
  if (!tenantSets) {
    tenantSets = new Map();
    sets.set(kind, tenantSets);
  }
  if (tables) {
    tenantSets.set(tenantId, tables);
  } else {
    tenantSets.delete(tenantId);
  }
};

const findCycleForTenant = (
  jobs: Array<DispatchedJob>,
  readsOf: (kind: string) => Set<string> | undefined,
  writesByKind: Map<string, Set<string>>,
): Array<string> | null => {
  const feeds = (a: DispatchedJob, b: DispatchedJob): boolean => {
    if (a.kind === b.kind) {
      return false;
    }
    const reads = readsOf(b.kind);
    const writes = writesByKind.get(a.kind);
    if (!reads || !writes) {
      return false;
    }
    if (reads.has(SUBSCRIBE_ALL_SENTINEL)) {
      return [...writes].some((table) => !RUNTIME_TABLES.has(table));
    }
    return [...writes].some((table) => reads.has(table));
  };

  const visiting = new Set<string>();
  const done = new Set<string>();
  const stack: Array<string> = [];

  const visit = (job: DispatchedJob): Array<string> | null => {
    if (done.has(job.kind)) {
      return null;
    }
    if (visiting.has(job.kind)) {
      return [...stack.slice(stack.indexOf(job.kind)), job.kind];
    }
    visiting.add(job.kind);
    stack.push(job.kind);
    for (const other of jobs) {
      if (feeds(job, other)) {
        const cycle = visit(other);
        if (cycle) {
          return cycle;
        }
      }
    }
    stack.pop();
    visiting.delete(job.kind);
    done.add(job.kind);
    return null;
  };

  for (const job of jobs) {
    const cycle = visit(job);
    if (cycle) {
      return cycle;
    }
  }
  return null;
};

/**
 * Names mutual feeding between jobs: A's writes wake B and B's writes wake A. It is reported, never
 * acted on: every observed job is watermark-scoped, so the woken job finds nothing stale and the
 * loop stops, where cutting the routing would freeze both jobs on whatever subscription they happen
 * to hold. The graph is walked one tenant at a time, on that tenant's own read sets, because two
 * tenants' recomputes never feed each other; the writer side is unioned over tenants, because a
 * write to a global table rings for every tenant. A job writing a table it also reads is not named:
 * that is the case the origin tag exists for. A persisted subscribe-all reads every non-runtime
 * table, because that is what it routes on; a job with no observation at all is left out of the
 * graph, since the state before a first run resolves itself as soon as that run installs a set.
 */
export const findFeedingCycle = (
  jobs: Array<DispatchedJob>,
  readSets: TableSets,
  writeSets: TableSets,
): Array<string> | null => {
  const writesByKind = unionByKind(writeSets);
  const tenantIds = new Set<string>();
  for (const tenantSets of readSets.values()) {
    for (const tenantId of tenantSets.keys()) {
      tenantIds.add(tenantId);
    }
  }
  for (const tenantId of tenantIds) {
    const cycle = findCycleForTenant(jobs, (kind) => readSets.get(kind)?.get(tenantId), writesByKind);
    if (cycle) {
      return cycle;
    }
  }
  return null;
};

interface PendingEnqueue {
  timer: unknown,
  reason: DispatcherAskReason,
  /** One interactive event among those folded into this ask makes the whole ask interactive: a
   *  save must not inherit a sweep's window because the sweep asked first. */
  interactive: boolean,
}

/** Which origins asked for a pending run, so a run nothing but other jobs asked for is countable. */
interface AskProvenance {
  origins: Set<string>,
  /** The origins, and the routed jobs behind their own latest asks. */
  chain: Set<string>,
  jobsOnly: boolean,
}

/**
 * What changed for one (job, tenant) while its run was in flight. The tables are kept rather than
 * filtered on arrival: a run can be the one discovering a table, which its persisted read set does
 * not name yet, so only its own observation can say whether the change matters.
 */
interface RunChanges {
  /** Each changed table, with who changed it: a follow-up carries on the asks it answers. */
  tables: Map<string, AskProvenance>,
  /** A debounce or a reconnect that fired mid-run: already known to matter, whatever the tables. */
  forced: boolean,
  interactive: boolean,
}

export const createDispatcher = (jobs: Array<DispatchedJob>, deps: DispatcherDeps) => {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- default handles come only from the default setTimeout above
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));
  const { settings } = deps;

  const readSets: TableSets = new Map();
  const writeSets: TableSets = new Map();
  const pending = new Map<string, PendingEnqueue>();
  const running = new Set<string>();
  const changedDuringRun = new Map<string, RunChanges>();
  const lastRunDurationMs = new Map<string, number>();
  /**
   * How fast asks for one (kind, tenant) can possibly follow one another: the debounce, which is
   * the floor only until a run has been measured. The cycle alarm divides by this rather than by
   * the floor, or a cycle between two slow recomputes could never reach a count the floor sets.
   */
  const pacingDelayMs = (entryKey: string): number => {
    const measured = lastRunDurationMs.get(entryKey);
    return Math.min(
      Math.max(measured === undefined ? settings.floorMs : settings.factor * measured, settings.floorMs),
      settings.capMs,
    );
  };
  const retryDelayMs = new Map<string, number>();
  const observedThisSession = new Set<string>();
  const reportedCycles = new Set<string>();
  const askProvenance = new Map<string, AskProvenance>();
  /**
   * The chain behind the latest ask booked for each (kind, tenant), empty once an outside source took
   * part in it. It is what that run's writes pass on, since a run does what its ask asked for.
   */
  const askChains = new Map<string, Set<string>>();
  const jobDrivenAskTimes = new Map<string, Array<number>>();
  let knownTenantIds: Array<string> = [];
  let knownTenants = new Set<string>();
  let stopped = false;
  let lastCatchUpAtMs: number | undefined;
  let deferredCatchUp: unknown;
  let topology = createDoorbellTopology([]);

  const isRouted = (job: DispatchedJob): boolean => job.observed;

  /**
   * Once per distinct cycle: every observation refresh of a job in one detects it again, and a
   * tenant running the connector refreshes several a minute. What a cycle is worth saying is said by
   * the first one; the alarm for a cycle that does not converge is `countJobDrivenAsk` below.
   */
  const reportFeedingCycle = (cycle: Array<string>): void => {
    const signature = cycle.join(' -> ');
    if (reportedCycles.has(signature)) {
      return;
    }
    reportedCycles.add(signature);
    deps.onFeedingCycle?.(cycle);
  };

  const routedKinds = new Set(jobs.filter(isRouted).map((job) => job.kind));

  const newProvenance = (): AskProvenance => ({ origins: new Set(), chain: new Set(), jobsOnly: true });

  /**
   * Only a routed job can sit in a cycle, since nothing else is woken by a change: a write from a
   * connector sync or any job booked on its own schedule is an outside ask, like a user's, however
   * many times a long run of it rings. A routed job's write passes on the chain of its own latest
   * ask, so a job relaying an outside burst downstream is told apart from one its writes come back to.
   * A write to a global table does not say which tenant's run made it, so it passes on the chains of
   * all of them.
   */
  const addOrigin = (provenance: AskProvenance, origin: string | null, writerTenantId: string | null): void => {
    if (origin === null || !routedKinds.has(origin)) {
      provenance.jobsOnly = false;
      return;
    }
    provenance.origins.add(origin);
    provenance.chain.add(origin);
    const chains = writerTenantId === null
      ? knownTenantIds.map((tenantId) => askChains.get(key(origin, tenantId)))
      : [askChains.get(key(origin, writerTenantId))];
    chains.forEach((chain) => chain?.forEach((kind) => provenance.chain.add(kind)));
  };

  const mergeProvenance = (into: AskProvenance, from: AskProvenance): void => {
    from.origins.forEach((origin) => into.origins.add(origin));
    from.chain.forEach((kind) => into.chain.add(kind));
    into.jobsOnly = into.jobsOnly && from.jobsOnly;
  };

  const noteAskOrigin = (entryKey: string, origin: string | null, writerTenantId: string | null): void => {
    const provenance = askProvenance.get(entryKey) ?? newProvenance();
    addOrigin(provenance, origin, writerTenantId);
    askProvenance.set(entryKey, provenance);
  };

  /**
   * Reports a (kind, tenant) asked for again and again by the writes its own runs set off, which is a
   * cycle that is not converging. Nothing is paused: only the run itself can tell an empty recompute
   * from a real one.
   */
  const countJobDrivenAsk = (kind: string, tenantId: string, entryKey: string): void => {
    const provenance = askProvenance.get(entryKey);
    askProvenance.delete(entryKey);
    const jobDriven = provenance !== undefined && provenance.jobsOnly && provenance.origins.size > 0;
    if (provenance !== undefined) {
      askChains.set(entryKey, jobDriven ? provenance.chain : new Set());
    }
    if (!jobDriven || !provenance.chain.has(kind)) {
      jobDrivenAskTimes.delete(entryKey);
      return;
    }
    const nowMs = now();
    const times = [...(jobDrivenAskTimes.get(entryKey) ?? []).filter((at) => nowMs - at < JOB_DRIVEN_ASK_WINDOW_MS), nowMs];
    const threshold = Math.max(2, Math.ceil(JOB_DRIVEN_ASK_WINDOW_MS / pacingDelayMs(entryKey) / JOB_DRIVEN_ASK_CEILING_SHARE));
    if (times.length >= threshold) {
      jobDrivenAskTimes.set(entryKey, []);
      deps.onNonConvergingCycle?.({
        kind,
        tenantId,
        asks: times.length,
        windowMs: JOB_DRIVEN_ASK_WINDOW_MS,
        threshold,
        origins: [...provenance.origins].sort(),
        chain: [...provenance.chain].sort(),
      });
      return;
    }
    jobDrivenAskTimes.set(entryKey, times);
  };

  const isSubscribed = (kind: string, tenantId: string, table: string): boolean => {
    const tables = readSets.get(kind)?.get(tenantId);
    if (!tables || tables.has(SUBSCRIBE_ALL_SENTINEL)) {
      return !RUNTIME_TABLES.has(table);
    }
    return tables.has(table);
  };

  const noteChangeDuringRun = (
    entryKey: string,
    table: string | null,
    interactive: boolean,
    origin: string | null = null,
    writerTenantId: string | null = null,
  ): void => {
    const changes = changedDuringRun.get(entryKey) ?? { tables: new Map<string, AskProvenance>(), forced: false, interactive: false };
    if (table === null) {
      changes.forced = true;
    } else {
      const provenance = changes.tables.get(table) ?? newProvenance();
      addOrigin(provenance, origin, writerTenantId);
      changes.tables.set(table, provenance);
    }
    changes.interactive = changes.interactive || interactive;
    changedDuringRun.set(entryKey, changes);
  };

  const forgetTenant = (tenantId: string): void => {
    const suffix = `::${tenantId}`;
    for (const [entryKey, entry] of pending) {
      if (entryKey.endsWith(suffix)) {
        clearTimer(entry.timer);
        pending.delete(entryKey);
      }
    }
    for (const entryKey of running) {
      if (entryKey.endsWith(suffix)) {
        running.delete(entryKey);
      }
    }
    for (const bookkeeping of [changedDuringRun, lastRunDurationMs, retryDelayMs, askProvenance, askChains, jobDrivenAskTimes]) {
      for (const entryKey of bookkeeping.keys()) {
        if (entryKey.endsWith(suffix)) {
          bookkeeping.delete(entryKey);
        }
      }
    }
    for (const entryKey of observedThisSession) {
      if (entryKey.endsWith(suffix)) {
        observedThisSession.delete(entryKey);
      }
    }
    for (const sets of [readSets, writeSets]) {
      for (const tenantSets of sets.values()) {
        tenantSets.delete(tenantId);
      }
    }
  };

  const doEnqueue = (kind: string, tenantId: string, reason: DispatcherAskReason, interactive: boolean): void => {
    const entryKey = key(kind, tenantId);
    countJobDrivenAsk(kind, tenantId, entryKey);
    deps.enqueue(kind, tenantId, reason, interactive)
      .then(() => {
        retryDelayMs.delete(entryKey);
      })
      .catch((err: unknown) => {
        deps.onError(err, `enqueue ${kind} for ${tenantId}`);
        // A failure that never clears (a queue gone, a tenant vanished under the FK) would
        // otherwise be re-asked at debounce cadence for the life of the process.
        const previous = retryDelayMs.get(entryKey);
        retryDelayMs.set(entryKey, previous === undefined ? settings.floorMs : Math.min(previous * 2, settings.capMs));
        schedule(kind, tenantId, reason, interactive);
      });
  };

  const fire = (kind: string, tenantId: string, reason: DispatcherAskReason, interactive: boolean): void => {
    if (stopped) {
      return;
    }
    const existing = pending.get(key(kind, tenantId));
    if (existing) {
      clearTimer(existing.timer);
      pending.delete(key(kind, tenantId));
    }
    if (!knownTenants.has(tenantId)) {
      // `jobs.tenant_id` references `tenants`: the enqueue could only fail on the foreign key.
      forgetTenant(tenantId);
      deps.onError(
        newError('Dropping a recompute ask for a tenant that no longer exists', { kind, tenantId, reason }),
        `enqueue ${kind} for ${tenantId}`,
      );
      return;
    }
    if (running.has(key(kind, tenantId))) {
      // The running run may already have read past this change: folding into it through the
      // dedup index would lose it, hence the follow-up on completion.
      noteChangeDuringRun(key(kind, tenantId), null, interactive);
      return;
    }
    doEnqueue(kind, tenantId, reason, interactive);
  };

  const schedule = (kind: string, tenantId: string, reason: DispatcherAskReason, interactive: boolean): void => {
    if (stopped) {
      return;
    }
    const entryKey = key(kind, tenantId);
    if (running.has(entryKey)) {
      noteChangeDuringRun(entryKey, null, interactive);
      return;
    }
    // The first event of a burst sets the deadline and the ask it carries folds every later one:
    // were it re-armed on each event, the timer would never expire under a table written faster
    // than the delay, which is what a backfill is. The class is the one thing a later event still
    // raises, so a save landing behind a sweep's pending ask is not served on the sweep's window.
    const pendingAsk = pending.get(entryKey);
    if (pendingAsk) {
      pendingAsk.interactive = pendingAsk.interactive || interactive;
      return;
    }
    const delay = pacingDelayMs(entryKey);
    // While the enqueue is failing its own escalating delay governs, so a table written
    // continuously cannot pull the next attempt back to the floor.
    const retryMs = retryDelayMs.get(entryKey);
    const waitMs = retryMs === undefined ? delay : Math.max(retryMs, delay);
    // The timer reads the entry rather than closing over `interactive`: an event folded in before
    // it expires raises the class, and the ask must fire on the raised one.
    const entry: PendingEnqueue = { timer: undefined, reason, interactive };
    entry.timer = setTimer(() => fire(kind, tenantId, reason, entry.interactive), Math.max(0, waitMs));
    pending.set(entryKey, entry);
  };

  const refreshTenants = async (): Promise<void> => {
    const ids = await deps.listTenantIds();
    const refreshed = new Set(ids);
    for (const tenantId of knownTenants) {
      if (!refreshed.has(tenantId)) {
        forgetTenant(tenantId);
      }
    }
    knownTenantIds = ids;
    knownTenants = refreshed;
  };

  const routeEvent = (event: DataChangedEvent): void => {
    if ((event.tenantId != null && !knownTenants.has(event.tenantId)) || (event.origin != null && UNROUTED_ORIGINS.has(event.origin))) {
      return;
    }
    const tables = topology.tablesChangedBy(event.table, event.op);
    // A user's own write has somebody waiting by definition and declares nothing; a job's write
    // passes on what its run declared, so a nightly sweep cannot hand the page a fast window.
    const sourceInteractive = event.interactive ?? event.origin == null;
    for (const job of jobs) {
      // A global table is written once for the tenant the job ran for, and rings for all of them:
      // routing the job's own echo to the other tenants would ping-pong it between them forever,
      // so the echo is dropped by kind alone.
      if (!isRouted(job) || (event.origin != null && event.origin === job.kind)) {
        continue;
      }
      const tenantIds = event.tenantId != null ? [event.tenantId] : knownTenantIds;
      for (const tenantId of tenantIds) {
        const entryKey = key(job.kind, tenantId);
        if (running.has(entryKey)) {
          tables.forEach((table) => noteChangeDuringRun(entryKey, table, sourceInteractive, event.origin ?? null, event.tenantId ?? null));
        } else if ([...tables].some((table) => isSubscribed(job.kind, tenantId, table))) {
          noteAskOrigin(entryKey, event.origin ?? null, event.tenantId ?? null);
          schedule(job.kind, tenantId, 'change', sourceInteractive);
        }
      }
    }
  };

  // Events are processed in order: a global-table event right after a tenant creation must see
  // the refreshed tenant list, so the refresh is awaited before anything behind it is routed.
  let eventChain: Promise<void> = Promise.resolve();

  const catchUp = (): void => {
    lastCatchUpAtMs = now();
    eventChain = eventChain
      .then(async () => {
        await refreshTenants();
        for (const job of jobs.filter(isRouted)) {
          for (const tenantId of knownTenantIds) {
            noteAskOrigin(key(job.kind, tenantId), null, tenantId);
            schedule(job.kind, tenantId, 'reconnect', false);
          }
        }
      })
      .catch((err) => deps.onError(err, 'reconnect'));
  };

  return {
    start: async (): Promise<void> => {
      if (stopped) {
        return;
      }
      const rows = await deps.loadObservations();
      const loaded = new Map<string, { kind: string, tenantId: string, reads: Set<string>, writes: Set<string> }>();
      for (const row of rows) {
        const entryKey = key(row.jobKind, row.tenantId);
        const entry = loaded.get(entryKey)
          ?? { kind: row.jobKind, tenantId: row.tenantId, reads: new Set<string>(), writes: new Set<string>() };
        (row.access === 'write' ? entry.writes : entry.reads).add(row.tableName);
        loaded.set(entryKey, entry);
      }
      for (const [entryKey, entry] of loaded) {
        // Engines start in parallel, so a run can have claimed, completed and installed its own
        // observation while these rows were loading: folding the persisted set into that one
        // would widen the subscription back until the next run.
        if (observedThisSession.has(entryKey)) {
          continue;
        }
        if (entry.reads.size > 0) {
          setTables(readSets, entry.kind, entry.tenantId, entry.reads);
        }
        if (entry.writes.size > 0) {
          setTables(writeSets, entry.kind, entry.tenantId, entry.writes);
        }
      }
      await refreshTenants();
      topology = createDoorbellTopology(await deps.loadDoorbellParents?.() ?? []);

      const cycle = findFeedingCycle(jobs, readSets, writeSets);
      if (cycle) {
        reportFeedingCycle(cycle);
      }
    },

    handleEvent: (event: DataChangedEvent): void => {
      eventChain = eventChain
        .then(async () => {
          if (event.table === 'tenants') {
            await refreshTenants();
          }
          routeEvent(event);
        })
        .catch((err) => deps.onError(err, `event on ${event.table}`));
    },

    /** LISTEN reconnect: a notification may have been lost, a tenant creation included, so the
     * tenant list is reloaded and every job owes a run for every tenant. A second catch-up inside
     * the interval is deferred rather than dropped, since only a catch-up recovers what was lost
     * during its own disconnect. */
    markAllDirty: (): void => {
      if (stopped || deferredCatchUp !== undefined) {
        return;
      }
      const nowMs = now();
      const dueAtMs = lastCatchUpAtMs === undefined ? nowMs : lastCatchUpAtMs + settings.reconnectMinIntervalMs;
      if (dueAtMs <= nowMs) {
        catchUp();
        return;
      }
      deferredCatchUp = setTimer(() => {
        deferredCatchUp = undefined;
        catchUp();
      }, dueAtMs - nowMs);
    },

    onRunStarted: (kind: string, tenantId: string): void => {
      const entryKey = key(kind, tenantId);
      // A pending ask stands for changes committed before this run started, which the run will
      // read: letting it fire mid-run would force a follow-up for nothing, and in shadow mode the
      // manual path starts the run before the debounce expires as a matter of course.
      const existing = pending.get(entryKey);
      if (existing) {
        clearTimer(existing.timer);
        pending.delete(entryKey);
        // The run answers the ask, so its writes pass on that ask's chain, not the one before.
        countJobDrivenAsk(kind, tenantId, entryKey);
        deps.onAskAbsorbed?.(kind, tenantId, existing.reason);
      }
      retryDelayMs.delete(entryKey);
      changedDuringRun.delete(entryKey);
      running.add(entryKey);
    },

    onRunCompleted: (kind: string, tenantId: string, durationMs: number, completed: CompletedRunObservation | null): void => {
      const entryKey = key(kind, tenantId);
      running.delete(entryKey);
      lastRunDurationMs.set(entryKey, durationMs);
      if (completed !== null) {
        const { observation } = completed;
        observedThisSession.add(entryKey);
        setTables(readSets, kind, tenantId, new Set(observation.reads));
        setTables(writeSets, kind, tenantId, new Set(observation.writes));
        // What the run read is what it stays subscribed to, cycle or not: a set held back because
        // it closes a loop is a subscription that describes no run at all.
        const cycle = findFeedingCycle(jobs, readSets, writeSets);
        if (cycle) {
          reportFeedingCycle(cycle);
        }
        if (!completed.persisted) {
          // The run holds the widened set in memory only, so the persisted one is narrower than
          // what it read and a restart before the next successful run would resubscribe to it.
          deps.persistObservation(kind, tenantId, observation)
            .catch((err) => deps.onError(err, `persist observation of ${kind} for ${tenantId}`));
        }
      }
      const changes = changedDuringRun.get(entryKey);
      changedDuringRun.delete(entryKey);
      // Decided against the observation this run just produced, so a table it discovered while
      // that table was changing owes a follow-up, and one it turned out not to read owes none.
      const relevant = changes === undefined
        ? []
        : [...changes.tables].filter(([table]) => isSubscribed(kind, tenantId, table)).map(([, provenance]) => provenance);
      if (changes && (changes.forced || relevant.length > 0)) {
        // A forced change's provenance was noted when it was asked for; a table's is what this run
        // missed, and a loop whose every answer lands mid-run would otherwise never be counted.
        const provenance = askProvenance.get(entryKey) ?? newProvenance();
        relevant.forEach((tableProvenance) => mergeProvenance(provenance, tableProvenance));
        askProvenance.set(entryKey, provenance);
        // Spaced like any other ask: an immediate follow-up would chain full-estate recomputes
        // back to back under a sustained write stream.
        schedule(kind, tenantId, 'followup', changes.interactive);
      }
    },

    stop: (): void => {
      stopped = true;
      for (const entry of pending.values()) {
        clearTimer(entry.timer);
      }
      pending.clear();
      changedDuringRun.clear();
      askProvenance.clear();
      askChains.clear();
      jobDrivenAskTimes.clear();
      if (deferredCatchUp !== undefined) {
        clearTimer(deferredCatchUp);
        deferredCatchUp = undefined;
      }
    },
  };
};
