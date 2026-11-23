import { AsyncLocalStorage } from 'node:async_hooks';
import type { StatementTables } from '@app/module';
import { collectPlanTables, NON_PLANNABLE, TABLES_WITHOUT_DATA_CHANGED_TRIGGER } from '@app/module';
import type { Logger } from 'drizzle-orm';
import { EVERY_TABLE } from './data-changed-hub';

interface ObservedCall {
  procedure: string,
  pending: Array<Promise<void>>,
}

const currentCall = new AsyncLocalStorage<ObservedCall>();

/** Resolves to the rows of `EXPLAIN (GENERIC_PLAN, FORMAT JSON) <sqlText>`, placeholders unbound. */
export type GenericPlanRunner = (sqlText: string) => Promise<unknown>;

export type WideningReason = 'explain_refused' | 'attribution_deferred' | 'silent_table';

export interface Widening {
  procedure: string,
  reason: WideningReason,
  /** The statement whose plan is missing, or the table no doorbell ever rings for. */
  subject: string,
  error?: unknown,
}

export interface QueryDependencyIndexOptions {
  explain: GenericPlanRunner,
  /** Fired once per (procedure, statement) that widens, so the log names each shape to review. */
  onWidened?: (widening: Widening) => void,
  /**
   * How long a call waits for a plan before it widens, `ATTRIBUTION_DEADLINE_MS` by default;
   * `null` waits for the plan, for a caller that checks attribution rather than latency.
   */
  attributionDeadlineMs?: number | null,
}

export interface DoorbellTargets {
  procedures: Array<string>,
  /** The doorbell stands for every table, so every procedure is stale. */
  all: boolean,
}

export interface QueryDependencyIndexSnapshot {
  statements: number,
  explainsOk: number,
  explainsRefused: number,
  shapes: number,
  observed: number,
  declared: number,
  widened: number,
  withoutReads: number,
}

type Shape = { reads: ReadonlySet<string> } | { refused: unknown };

/**
 * A comma-separated run of placeholders is a bound list, and `inArray` emits one placeholder per
 * element, so one query reaches here as one statement text per list length. The relations of the
 * plan do not depend on that length, so collapsing the run keys every length onto one plan, which
 * is what keeps the number of shapes bounded by the code rather than by the data.
 */
const PLACEHOLDER_RUN = /\$\d+(?:\s*,\s*\$\d+)+/g;

const shapeKeyOf = (query: string): string => query.replace(PLACEHOLDER_RUN, () => '$*');

/** Backstop against a shape this process never repeats: past it, a plan is used but not retained. */
const SHAPE_CACHE_MAX_ENTRIES = 5_000;

/**
 * How long a call waits for the plan of a statement it just issued. The EXPLAIN borrows from the
 * same pool the request does, and that pool hands out a connection or times out after five
 * seconds, so waiting for it unbounded turns a saturated pool into five-second responses and
 * feeds the saturation that caused it. A measured plan comes back in under three milliseconds,
 * batch-sized bound lists included; past this the response goes out and the procedure is named on
 * every doorbell until the plan lands.
 */
export const ATTRIBUTION_DEADLINE_MS = 250;

/**
 * Learns, per tRPC query procedure, which tables its statements read, so a doorbell can name the
 * procedures a change made stale. One instance is the Drizzle logger of the shared database
 * instance: the procedure a statement belongs to is read from the async scope `observe()` opens,
 * which tells concurrent requests apart.
 *
 * Every distinct statement shape is EXPLAINed once, with `GENERIC_PLAN` (PostgreSQL 16 or later):
 * a bound plan folds a parameter-gated read away for the values that skip it, the generic plan
 * lists it, so one plan per shape is valid for every input.
 *
 * Only an observed or declared read set narrows a procedure; everything else names it on every
 * doorbell. That includes a procedure whose calls issued no attributable read at all, which is not
 * the same as depending on nothing: a procedure returning what the tRPC context resolved (the
 * session's own user, read before any observed scope exists) issues no statement of its own and
 * still goes stale, unless it declares the tables that context read. A plan that has not come back
 * yet widens the same way, so a call never waits on one for long.
 *
 * Nothing is persisted, and a procedure this process never served is left out of doorbells on
 * purpose: the SSE stream reconnects after a restart and the client resyncs its whole cache then,
 * so every result a client holds was served, hence observed, by the current process. That holds
 * for one http process. With several, the stream and the queries of one client must reach the same
 * one (sticky sessions), or the index must be shared between them.
 */
export class QueryDependencyIndex implements Logger {
  private readonly readsByProcedure = new Map<string, Set<string>>();
  private readonly proceduresByTable = new Map<string, Set<string>>();
  private readonly served = new Set<string>();
  private readonly unattributedByProcedure = new Map<string, Set<string>>();
  private readonly silentTableReaders = new Set<string>();
  private readonly declaredProcedures = new Set<string>();
  private readonly shapes = new Map<string, Promise<Shape>>();
  private statements = 0;
  private explainsOk = 0;
  private explainsRefused = 0;

  constructor(private readonly options: QueryDependencyIndexOptions) {}

  /**
   * Runs `invoke` as one call of `procedure` and returns once every statement it issued is
   * attributed, or named on every doorbell for want of a plan, so a client never caches a result
   * the index has not accounted for.
   *
   * `declaredReads` adds to the observed reads the tables a result takes from what no statement of
   * the call reads, the request context or process memory, and makes a procedure that attributes no
   * read narrowable: `[]` is a result no table write can make stale.
   */
  async observe<R extends { ok: boolean }>(procedure: string, invoke: () => Promise<R>, declaredReads?: ReadonlyArray<string>): Promise<R> {
    const call: ObservedCall = { procedure, pending: [] };
    let result: R;
    try {
      result = await currentCall.run(call, invoke);
    } finally {
      await Promise.all(call.pending);
    }
    if (result.ok) {
      this.served.add(procedure);
      if (declaredReads !== undefined) {
        this.declare(procedure, declaredReads);
      }
    }
    return result;
  }

  logQuery(query: string): void {
    const call = currentCall.getStore();
    if (call === undefined || NON_PLANNABLE.test(query)) {
      return;
    }
    this.statements += 1;
    const key = shapeKeyOf(query);
    const attribution = this.shapeOf(key, query).then((shape) => this.attribute(call.procedure, key, shape));
    call.pending.push(this.withDeadline(attribution, call.procedure, key));
  }

  /**
   * The procedures a change to `tables` may have made stale: the observed readers of those tables,
   * plus every procedure this process served whose reads it cannot vouch for.
   */
  targetsOf(tables: Iterable<string>): DoorbellTargets {
    const procedures = new Set<string>();
    for (const procedure of this.served) {
      if (!this.readsByProcedure.has(procedure)) {
        procedures.add(procedure);
      }
    }
    this.widenedProcedures().forEach((procedure) => procedures.add(procedure));
    for (const table of tables) {
      if (table === EVERY_TABLE) {
        return { procedures: [], all: true };
      }
      this.proceduresByTable.get(table)?.forEach((procedure) => procedures.add(procedure));
    }
    return { procedures: [...procedures].sort(), all: false };
  }

  readsOf(procedure: string): Array<string> {
    return [...this.readsByProcedure.get(procedure) ?? []].sort();
  }

  widenedProcedures(): Array<string> {
    const widened = new Set(this.unattributedByProcedure.keys());
    this.silentTableReaders.forEach((procedure) => widened.add(procedure));
    return [...widened].sort();
  }

  snapshot(): QueryDependencyIndexSnapshot {
    const widened = this.widenedProcedures().length;
    const narrowed = [...this.readsByProcedure.keys()].filter((procedure) => !this.isWidened(procedure));
    const declared = narrowed.filter((procedure) => this.declaredProcedures.has(procedure)).length;
    const withoutReads = [...this.served]
      .filter((procedure) => !this.readsByProcedure.has(procedure) && !this.isWidened(procedure)).length;
    return {
      statements: this.statements,
      explainsOk: this.explainsOk,
      explainsRefused: this.explainsRefused,
      shapes: this.shapes.size,
      observed: narrowed.length - declared,
      declared,
      widened,
      withoutReads,
    };
  }

  private isWidened(procedure: string): boolean {
    return this.unattributedByProcedure.has(procedure) || this.silentTableReaders.has(procedure);
  }

  /** Resolves at the deadline whatever the plan does, so no response waits on the database twice. */
  private withDeadline(attribution: Promise<void>, procedure: string, key: string): Promise<void> {
    const deadlineMs = this.options.attributionDeadlineMs === undefined ? ATTRIBUTION_DEADLINE_MS : this.options.attributionDeadlineMs;
    if (deadlineMs === null) {
      return attribution;
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.markUnattributed(procedure, key, 'attribution_deferred');
        resolve();
      }, deadlineMs);
      timer.unref();
      void attribution.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private shapeOf(key: string, query: string): Promise<Shape> {
    const known = this.shapes.get(key);
    if (known !== undefined) {
      return known;
    }
    const shape = this.explainShape(query).then((resolved) => {
      // A refused EXPLAIN is not retained: a connection the saturated pool never granted would
      // otherwise pin the widening of every procedure issuing that shape for the life of the process.
      if ('refused' in resolved) {
        this.shapes.delete(key);
      }
      return resolved;
    });
    if (this.shapes.size < SHAPE_CACHE_MAX_ENTRIES) {
      this.shapes.set(key, shape);
    }
    return shape;
  }

  private async explainShape(query: string): Promise<Shape> {
    try {
      const plan = await this.options.explain(`EXPLAIN (GENERIC_PLAN, FORMAT JSON) ${query}`);
      const tables: StatementTables = { reads: new Set(), writes: new Set() };
      collectPlanTables(plan, tables);
      this.explainsOk += 1;
      return { reads: tables.reads };
    } catch (error) {
      this.explainsRefused += 1;
      return { refused: error };
    }
  }

  /** Never rejects: an attribution is awaited on the caller's own path, which it must not fail. */
  private attribute(procedure: string, key: string, shape: Shape): void {
    try {
      if ('refused' in shape) {
        this.markUnattributed(procedure, key, 'explain_refused', shape.refused);
        return;
      }
      this.clearUnattributed(key);
      // A statement reading no table (`select now()`) vouches for nothing the result may take from the context.
      if (shape.reads.size > 0) {
        this.recordReads(procedure, shape.reads);
      }
    } catch {
      // The widening report is the one thing here that runs code this class does not own.
    }
  }

  private declare(procedure: string, tables: ReadonlyArray<string>): void {
    if (this.declaredProcedures.has(procedure)) {
      return;
    }
    this.declaredProcedures.add(procedure);
    try {
      this.recordReads(procedure, tables);
    } catch {
      // The widening report is the one thing here that runs code this class does not own.
    }
  }

  /** Creates the procedure's read set even when `tables` is empty: an empty set is a procedure that depends on no table. */
  private recordReads(procedure: string, tables: Iterable<string>): void {
    let reads = this.readsByProcedure.get(procedure);
    if (reads === undefined) {
      reads = new Set();
      this.readsByProcedure.set(procedure, reads);
    }
    for (const table of tables) {
      reads.add(table);
      let readers = this.proceduresByTable.get(table);
      if (readers === undefined) {
        readers = new Set();
        this.proceduresByTable.set(table, readers);
      }
      readers.add(procedure);
      if (TABLES_WITHOUT_DATA_CHANGED_TRIGGER.has(table) && !this.silentTableReaders.has(procedure)) {
        this.silentTableReaders.add(procedure);
        this.options.onWidened?.({ procedure, reason: 'silent_table', subject: table });
      }
    }
  }

  private markUnattributed(procedure: string, key: string, reason: WideningReason, error?: unknown): void {
    const unattributed = this.unattributedByProcedure.get(procedure) ?? new Set<string>();
    this.unattributedByProcedure.set(procedure, unattributed);
    if (!unattributed.has(key)) {
      unattributed.add(key);
      this.options.onWidened?.({ procedure, reason, subject: key, error });
    }
  }

  /** A shape that plans on a later attempt clears the widening its own absence bought. */
  private clearUnattributed(key: string): void {
    for (const [procedure, unattributed] of this.unattributedByProcedure) {
      if (unattributed.delete(key) && unattributed.size === 0) {
        this.unattributedByProcedure.delete(procedure);
      }
    }
  }
}

let installed: QueryDependencyIndex | null = null;

/** The one index the tRPC middleware attributes query calls to; the events feature installs it at activation. */
export const installQueryDependencyIndex = (index: QueryDependencyIndex | null): void => {
  installed = index;
};

export const observeQueryProcedure = <R extends { ok: boolean }>(
  procedure: string,
  invoke: () => Promise<R>,
  declaredReads?: ReadonlyArray<string>,
): Promise<R> => (installed === null ? invoke() : installed.observe(procedure, invoke, declaredReads));
