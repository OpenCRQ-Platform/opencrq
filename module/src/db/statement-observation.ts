import type { Logger } from 'drizzle-orm';
import { TABLES_WITHOUT_DATA_CHANGED_TRIGGER } from './migration-conventions';

/** Statements Postgres cannot EXPLAIN and that touch no table: everything else that EXPLAIN
 * rejects is a read the observation could not attribute, and widens. */
export const NON_PLANNABLE = /^\s*(begin|commit|rollback|savepoint|release|set|reset|listen|unlisten|notify|discard|show|deallocate)\b/i;

/** The planner folds constants from bound values, so the same text can plan onto fewer relations
 * for other parameters: an attribution is only valid for the (text, params) pair it was made for. */
const statementKey = (sqlText: string, params: Array<unknown>): string => `${sqlText}\u0000${JSON.stringify(params)}`;

/**
 * Above this count no key is built at all, so the statement is neither deduplicated nor cached.
 * A batch statement carries one bound value per column per row (14 000 for a 1 000-row upsert):
 * serialising that into a key costs hundreds of kilobytes for a text that never recurs, since its
 * parameters are the rows themselves.
 */
const EXPLAIN_KEYED_PARAM_COUNT_MAX = 100;

/**
 * Above this length a built key is dropped, so the statement is neither deduplicated nor cached:
 * a batched insert sent as one jsonb payload binds a single parameter of hundreds of kilobytes,
 * a key that never recurs and that `seen` would otherwise hold until the run ends.
 */
const EXPLAIN_KEY_MAX_CHARS = 4_096;

export interface StatementTables {
  reads: Set<string>,
  writes: Set<string>,
}

interface PlanNode {
  'Node Type'?: string,
  Operation?: string,
  'Relation Name'?: string,
  'Conflict Resolution'?: string,
  Plans?: Array<PlanNode>,
}

const isPlanNode = (value: unknown): value is PlanNode => typeof value === 'object' && value !== null;

/**
 * Prefix the writer puts on an upsert it built so that the stored row never flows into the
 * outcome: the plan cannot tell it from a read-modify-write, the SET list not being in it.
 */
export const OVERWRITE_MARKER = '/* observation:overwrite */';

export const isOverwriteStatement = (sqlText: string): boolean => sqlText.startsWith(OVERWRITE_MARKER);

export interface CollectPlanOptions {
  /** The statement carries `OVERWRITE_MARKER`: its insert target is written, not read. */
  overwrite?: boolean,
}

/**
 * A `ModifyTable` node names the written relation; every other relation in the plan is read.
 * A conflict is decided on the stored row, an UPDATE consuming it and a NOTHING keeping it, so an
 * upsert target counts as read as well, unless the writer certified the upsert as an overwrite.
 */
export const collectPlanTables = (node: unknown, out: StatementTables, options: CollectPlanOptions = {}): void => {
  if (Array.isArray(node)) {
    node.forEach((item) => collectPlanTables(item, out, options));
    return;
  }
  if (!isPlanNode(node)) {
    return;
  }
  const relation = node['Relation Name'];
  if (typeof relation === 'string') {
    if (node['Node Type'] === 'ModifyTable') {
      out.writes.add(relation);
      const certified = options.overwrite === true && node.Operation === 'Insert' && node['Conflict Resolution'] === 'UPDATE';
      if (node['Conflict Resolution'] !== undefined && !certified) {
        out.reads.add(relation);
      }
    } else {
      out.reads.add(relation);
    }
  }
  for (const value of Object.values(node)) {
    if (typeof value === 'object' && value !== null) {
      collectPlanTables(value, out, options);
    }
  }
};

export interface ResolvedObservation {
  /** `null` means the observation failed and the subscription must stay subscribe-all. */
  reads: Array<string> | null,
  writes: Array<string>,
  unattributed: Array<string>,
}

/** Cross-run cache of (text, params) attributions, bounded so a heap of one-off keys cannot grow it. */
const explainCache = new Map<string, StatementTables>();
const EXPLAIN_CACHE_MAX_ENTRIES = 5_000;

/** Runs `EXPLAIN (FORMAT JSON) <sqlText>` bound with `params` and resolves to its rows. */
export type ExplainRunner = (sqlText: string, params: Array<unknown>) => Promise<unknown>;

/**
 * Drizzle logger that attributes every statement a job run emits, writes included. Attach it to
 * the run's own Drizzle instance and call `resolve()` once the run is over.
 *
 * A statement is EXPLAINed at the moment it is logged, so that no bound parameter outlives its own
 * EXPLAIN: a full-estate recompute emits a hundred upserts of 14 000 bound values each, which is
 * 200 MB of heap per run if they are held until the end. The EXPLAINs are chained one at a time, so
 * an observed run borrows at most one connection beside its own.
 */
export class StatementRecorder implements Logger {
  private readonly reads = new Set<string>();
  private readonly writes = new Set<string>();
  private readonly unattributed: Array<string> = [];
  private readonly seen = new Set<string>();
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly explain: ExplainRunner) {}

  logQuery(query: string, params: Array<unknown>): void {
    if (NON_PLANNABLE.test(query)) {
      return;
    }
    let key: string | null = null;
    if (params.length <= EXPLAIN_KEYED_PARAM_COUNT_MAX) {
      try {
        key = statementKey(query, params);
      } catch {
        // This runs inside Drizzle's synchronous logging hook: a parameter that cannot be
        // serialised must widen the observation, not fail the run's own query.
        this.unattributed.push(query);
        return;
      }
      if (key.length > EXPLAIN_KEY_MAX_CHARS) {
        key = null;
      }
    }
    if (key !== null) {
      if (this.seen.has(key)) {
        return;
      }
      this.seen.add(key);
      const cached = explainCache.get(key);
      if (cached !== undefined) {
        this.fold(cached);
        return;
      }
    }
    this.enqueueExplain(query, params, key);
  }

  /**
   * Waits for the queued EXPLAINs, then widens on any doubt: a statement EXPLAIN rejected, a run
   * that read nothing, or a read of a table that rings no doorbell and could therefore never wake
   * the job.
   */
  async resolve(): Promise<ResolvedObservation> {
    await this.chain;
    const unattributed = [...this.unattributed];
    for (const name of this.reads) {
      if (TABLES_WITHOUT_DATA_CHANGED_TRIGGER.has(name)) {
        unattributed.push(`read of silent table ${name}`);
      }
    }
    if (this.reads.size === 0 && unattributed.length === 0) {
      // A run that read nothing is an observation that saw nothing, not a job that depends on
      // nothing: persisting an empty set would be indistinguishable from never having run.
      unattributed.push('empty observation');
    }
    return {
      reads: unattributed.length > 0 ? null : [...this.reads].sort(),
      writes: [...this.writes].sort(),
      unattributed,
    };
  }

  private enqueueExplain(sqlText: string, params: Array<unknown>, key: string | null): void {
    this.chain = this.chain.then(async () => {
      const tables: StatementTables = { reads: new Set(), writes: new Set() };
      try {
        collectPlanTables(await this.explain(`EXPLAIN (FORMAT JSON) ${sqlText}`, params), tables, { overwrite: isOverwriteStatement(sqlText) });
      } catch {
        this.unattributed.push(sqlText);
        return;
      }
      this.fold(tables);
      // A failed EXPLAIN is not cached: a transient error would otherwise pin the widening.
      if (key !== null) {
        if (explainCache.size >= EXPLAIN_CACHE_MAX_ENTRIES) {
          explainCache.clear();
        }
        explainCache.set(key, tables);
      }
    });
  }

  private fold(tables: StatementTables): void {
    tables.reads.forEach((name) => this.reads.add(name));
    tables.writes.forEach((name) => this.writes.add(name));
  }
}
