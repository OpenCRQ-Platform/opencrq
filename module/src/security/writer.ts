/*
 * Drizzle ORM's table type system requires `any` in generic type parameters
 * (e.g., PgTableWithColumns<any>, PgUUID<any>). These are structural requirements
 * of the Drizzle API surface, not unsafe runtime usages.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion */
import { newError } from '@app/utils';
import { and, eq, getTableColumns, getTableName, is, SQL, sql } from 'drizzle-orm';
import type { IndexColumn, PgTableWithColumns, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { PgColumn, PgDialect } from 'drizzle-orm/pg-core';
import type { DrizzleDB, ReadonlyDrizzle, ReadonlyTransaction, Transaction } from '../db';
import type { EventOrigin, SecurityPolicyRule } from './policy';
import { OVERWRITE_MARKER } from '../db/statement-observation';
import { getSecurityPolicies, originJobTag } from './policy';

type AnyTable = PgTableWithColumns<any>;

// Renders a create condition to text so two rows asking the same question are recognised as one.
const insertPolicyDialect = new PgDialect();

/**
 * Relayed by the data_changed trigger functions into the notification payload as `origin` and
 * `interactive`, so the recompute dispatcher drops a job's own echo and the events hub picks a
 * doorbell window from whether anybody waits on the run rather than from who ran it.
 * Transaction-local (`set_config(..., true)`): the tag ends with the commit and never survives on
 * a pooled connection.
 */
const JOB_KIND_GUC = 'app.job_kind';
const JOB_INTERACTIVE_GUC = 'app.job_interactive';
const taggedTransactions = new WeakSet<object>();

const tagTransaction = async (tx: Transaction, eventOrigin: EventOrigin): Promise<void> => {
  const tag = originJobTag(eventOrigin);
  if (!tag || taggedTransactions.has(tx)) {
    return;
  }
  const interactive = tag.interactive ? 'true' : 'false';
  await tx.execute(sql`select set_config(${JOB_KIND_GUC}, ${tag.jobKind}, true), set_config(${JOB_INTERACTIVE_GUC}, ${interactive}, true)`);
  taggedTransactions.add(tx);
};

const makeThen = <TConfig, TResult>(
  config: TConfig,
  execute: (cfg: TConfig) => Promise<any>,
) => <TResult1 = TResult, TResult2 = never>(
  onfulfilled?: ((value: TResult) => TResult1 | PromiseLike<TResult1>) | null,
  onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
): Promise<TResult1 | TResult2> => execute(config).then(onfulfilled, onrejected);

type ConflictDoNothingConfig = {
  target?: IndexColumn | Array<IndexColumn>,
  where?: SQL,
};

type ConflictDoUpdateConfig<T extends AnyTable> = {
  target: IndexColumn | Array<IndexColumn>,
  targetWhere?: SQL,
  setWhere?: SQL,
  set: PgUpdateSetSource<T>,
};

/**
 * An upsert whose conflict branch takes `columns` from the incoming row and nothing from the
 * stored one. No `targetWhere`: a partial unique index cannot be inferred without one, and its
 * predicate would consult stored columns.
 */
type ConflictDoOverwriteConfig<T extends AnyTable> = {
  target: IndexColumn | Array<IndexColumn>,
  columns: Array<keyof T['$inferInsert'] & string>,
};

type InsertConflictConfig<T extends AnyTable> =
  | { readonly type: 'doNothing', readonly config?: ConflictDoNothingConfig }
  | { readonly type: 'doUpdate', readonly config: ConflictDoUpdateConfig<T> }
  | { readonly type: 'doOverwrite', readonly config: ConflictDoOverwriteConfig<T> };

/** An overwrite reaches a statement as the `do update` it stands for. */
type RenderedConflictConfig<T extends AnyTable> = Exclude<InsertConflictConfig<T>, { type: 'doOverwrite' }>;

interface InsertQueryConfig<T extends AnyTable> {
  readonly table: T,
  readonly values: Array<T['$inferInsert']>,
  readonly conflict?: InsertConflictConfig<T>,
  readonly returningAll: boolean,
}

interface ProtectedInsertQuery<T extends AnyTable, TResult> extends PromiseLike<TResult> {
  returning: () => ProtectedInsertQuery<T, Array<T['$inferSelect']>>,
  onConflictDoNothing: (config?: ConflictDoNothingConfig) => ProtectedInsertQuery<T, TResult>,
  onConflictDoUpdate: (config: ConflictDoUpdateConfig<T>) => ProtectedInsertQuery<T, TResult>,
  onConflictDoOverwrite: (config: ConflictDoOverwriteConfig<T>) => ProtectedInsertQuery<T, TResult>,
}

interface ProtectedInsertBuilder<T extends AnyTable> {
  values: ((value: T['$inferInsert']) => ProtectedInsertQuery<T, void>) & ((values: Array<T['$inferInsert']>) => ProtectedInsertQuery<T, void>),
}

const createInsertQuery = <T extends AnyTable, TResult>(
  config: InsertQueryConfig<T>,
  execute: (cfg: InsertQueryConfig<T>) => Promise<any>,
): ProtectedInsertQuery<T, TResult> => ({
  returning: () => createInsertQuery<T, Array<T['$inferSelect']>>(
    { ...config, returningAll: true },
    execute,
  ),
  onConflictDoNothing: (conflictConfig?: ConflictDoNothingConfig) => createInsertQuery<T, TResult>(
    { ...config, conflict: { type: 'doNothing', config: conflictConfig } },
    execute,
  ),
  onConflictDoUpdate: (conflictConfig: ConflictDoUpdateConfig<T>) => createInsertQuery<T, TResult>(
    { ...config, conflict: { type: 'doUpdate', config: conflictConfig } },
    execute,
  ),
  onConflictDoOverwrite: (conflictConfig: ConflictDoOverwriteConfig<T>) => createInsertQuery<T, TResult>(
    { ...config, conflict: { type: 'doOverwrite', config: conflictConfig } },
    execute,
  ),
  then: makeThen<InsertQueryConfig<T>, TResult>(config, execute),
});

interface WhereQueryConfig<T extends AnyTable> {
  readonly table: T,
  readonly where: SQL | undefined,
  readonly returningAll: boolean,
}

interface UpdateQueryConfig<T extends AnyTable> extends WhereQueryConfig<T> {
  readonly values: Partial<T['$inferInsert']>,
}

type DeleteQueryConfig<T extends AnyTable> = WhereQueryConfig<T>;

interface ProtectedWhereQuery<T extends AnyTable, TResult> extends PromiseLike<TResult> {
  returning: () => ProtectedWhereQuery<T, Array<T['$inferSelect']>>,
}

interface ProtectedUpdateSetBuilder<T extends AnyTable> {
  where: (condition: SQL | undefined) => ProtectedWhereQuery<T, void>,
}

interface ProtectedUpdateBuilder<T extends AnyTable> {
  set: (values: Partial<T['$inferInsert']>) => ProtectedUpdateSetBuilder<T>,
}

interface ProtectedDeleteBuilder<T extends AnyTable> {
  where: (condition: SQL | undefined) => ProtectedWhereQuery<T, void>,
}

const createWhereQuery = <T extends AnyTable, TConfig extends WhereQueryConfig<T>, TResult>(
  config: TConfig,
  execute: (cfg: TConfig) => Promise<any>,
): ProtectedWhereQuery<T, TResult> => ({
  returning: () => createWhereQuery<T, TConfig, Array<T['$inferSelect']>>(
    { ...config, returningAll: true },
    execute,
  ),
  then: makeThen<TConfig, TResult>(config, execute),
});

/**
 * Row count from which an insert is sent as one jsonb payload instead of one bound parameter per
 * column per row. Drizzle types every value it binds, so on a batch that binding costs more than
 * the statement it produces, where a payload pays it once.
 */
const JSON_PAYLOAD_MIN_ROWS = 100;

/**
 * Column types a JSON round trip returns unchanged. `numeric` is absent on purpose, a JSON number
 * being a double; so are json, arrays, and every type whose driver mapping is structural.
 */
export const JSON_PAYLOAD_SAFE_TYPES = new Set([
  'uuid', 'text', 'boolean', 'smallint', 'integer', 'bigint',
  'real', 'double precision', 'date', 'timestamp', 'timestamp with time zone',
]);

export const isJsonPayloadSafe = (sqlType: string): boolean =>
  JSON_PAYLOAD_SAFE_TYPES.has(sqlType) || sqlType === 'varchar' || sqlType.startsWith('varchar(');

/**
 * Why an insert did not take the payload path. Reported so a test can assert that a batch fell
 * back for the reason it meant to exercise, and that no other batch fell back silently.
 */
export type InsertPathDecision =
  | { path: 'json-payload' }
  | {
    path: 'values',
    reason: 'below-threshold' | 'mixed-row-shapes' | 'no-columns' | 'unsupported-column'
    | 'unsupported-conflict-set' | 'unrepresentable-value',
  };

export interface ProtectedDBOptions {
  /** Rows below which an insert stays on `values()`. Lowered by the tests that pin the path. */
  jsonPayloadMinRows?: number,
  onInsertPath?: (decision: InsertPathDecision) => void,
}

interface JsonPayloadPlan {
  columns: Array<PgColumn>,
  payload: string,
}

const definedKeys = (row: Record<string, unknown>): Array<string> =>
  Object.keys(row).filter((key) => row[key] !== undefined);

const NUL = String.fromCharCode(0);
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Whether the `jsonb` parser reads a string back as the bound-parameter path writes it. A NUL and
 * an unpaired surrogate are the two characters `JSON.stringify` renders as a `\u` escape the parser
 * then refuses, where a bound parameter takes the first as an encoding error and the second as a
 * replacement character. On this path they would fail a whole batch Postgres accepts, or fail it
 * under another SQLSTATE.
 */
const isJsonSafeString = (value: string): boolean =>
  !value.includes(NUL) && !LONE_SURROGATE.test(value);

/**
 * Whether JSON carries a driver value unchanged. It does not carry `NaN` or either infinity, which
 * it writes as `null` where a bound parameter reaches Postgres as the float those spellings name;
 * it flattens `-0`; and it throws outright on a `bigint`, which a column declared in that mode
 * hands over. Anything it would alter sends the batch back to the bound-parameter path.
 */
const isJsonSafeValue = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return isJsonSafeString(value);
  }
  if (value === null || typeof value === 'boolean') {
    return true;
  }
  return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0);
};

/**
 * The payload and the column list for a set-based insert, or `null` when this batch must take the
 * `values()` path instead.
 *
 * A key left out of one row and set on another would take the column default on one and the
 * payload's null on the other, so the batch is only planned when every row carries the same keys.
 */
const planJsonPayload = <T extends AnyTable>(
  table: T,
  rows: Array<T['$inferInsert']>,
  minRows: number,
): JsonPayloadPlan | InsertPathDecision => {
  if (rows.length < minRows) {
    return { path: 'values', reason: 'below-threshold' };
  }
  const tableColumns = getTableColumns(table) as Record<string, PgColumn>;
  const keys = definedKeys(rows[0]);
  if (keys.length === 0) {
    return { path: 'values', reason: 'no-columns' };
  }
  const columns: Array<PgColumn> = [];
  for (const key of keys) {
    const column = tableColumns[key];
    if (!column || !isJsonPayloadSafe(column.getSQLType())) {
      return { path: 'values', reason: 'unsupported-column' };
    }
    columns.push(column);
  }
  const payloadRows: Array<Record<string, unknown>> = [];
  for (const row of rows as Array<Record<string, unknown>>) {
    if (definedKeys(row).length !== keys.length) {
      return { path: 'values', reason: 'mixed-row-shapes' };
    }
    const mapped: Record<string, unknown> = {};
    for (let index = 0; index < keys.length; index += 1) {
      const value = row[keys[index]];
      if (value === undefined) {
        return { path: 'values', reason: 'mixed-row-shapes' };
      }
      const column = columns[index];
      // A column's mapping accepts the values its own type admits and throws on the rest, an SQL
      // fragment standing where a row value may stand among them, so a refusal is a batch this
      // path cannot carry rather than an error to raise.
      let driverValue: unknown;
      try {
        driverValue = value === null || is(value, SQL) ? value : column.mapToDriverValue(value);
      } catch {
        return { path: 'values', reason: 'unrepresentable-value' };
      }
      if (!isJsonSafeValue(driverValue)) {
        return { path: 'values', reason: 'unrepresentable-value' };
      }
      mapped[column.name] = driverValue;
    }
    payloadRows.push(mapped);
  }
  return { columns, payload: JSON.stringify(payloadRows) };
};

const isPlan = (planned: JsonPayloadPlan | InsertPathDecision): planned is JsonPayloadPlan =>
  'columns' in planned;

const conflictTargetList = (target: IndexColumn | Array<IndexColumn>): SQL =>
  sql.join(
    (Array.isArray(target) ? target : [target]).map((column) => sql.identifier(column.name)),
    sql`, `,
  );

const conflictSetClause = <T extends AnyTable>(
  table: T,
  set: PgUpdateSetSource<T>,
): SQL | null => {
  const tableColumns = getTableColumns(table) as Record<string, PgColumn>;
  const assignments: Array<SQL> = [];
  for (const [key, value] of Object.entries(set)) {
    const column = tableColumns[key];
    if (!column || value === undefined) {
      return null;
    }
    // A bare value embedded in a template binds with no encoder, where `values()` wraps it in a
    // Param carrying its column, so the mapping has to be applied here to keep the two in step.
    // Null never reaches the encoder: a column mapping a date rejects it outright.
    const assigned = is(value, SQL) || value === null ? value : column.mapToDriverValue(value);
    assignments.push(sql`${sql.identifier(column.name)} = ${assigned}`);
  }
  return assignments.length === 0 ? null : sql.join(assignments, sql`, `);
};

const overwriteSet = <T extends AnyTable>(table: T, columns: Array<string>): PgUpdateSetSource<T> => {
  const tableColumns = getTableColumns(table) as Record<string, PgColumn>;
  const set: Record<string, SQL> = {};
  for (const key of columns) {
    const column = tableColumns[key];
    if (!column) {
      throw newError('Unknown column in overwrite', { table: getTableName(table), column: key });
    }
    set[key] = sql`excluded.${sql.identifier(column.name)}`;
  }
  return set;
};

/**
 * Every column a row carries is either matched by the conflict target or overwritten, and every
 * overwritten column is carried: a column left out would keep the stored value on conflict, unseen
 * by the caller and outside the read set, and one not carried would write the proposed default.
 */
const assertOverwriteShape = <T extends AnyTable>(
  table: T,
  overwrite: ConflictDoOverwriteConfig<T>,
  rows: Array<Record<string, unknown>>,
): void => {
  const tableName = getTableName(table);
  if (overwrite.columns.length === 0) {
    throw newError('An overwrite names at least one column', { table: tableName });
  }
  const keyByColumn = new Map(Object.entries(getTableColumns(table) as Record<string, PgColumn>).map(([key, column]) => [column, key]));
  const target = Array.isArray(overwrite.target) ? overwrite.target : [overwrite.target];
  const allowed = new Set<string>(overwrite.columns);
  for (const column of target) {
    const key = is(column, PgColumn) ? keyByColumn.get(column) : undefined;
    if (key !== undefined) {
      allowed.add(key);
    }
  }
  for (const row of rows) {
    for (const key of definedKeys(row)) {
      if (!allowed.has(key)) {
        throw newError('A column of an overwritten row is neither in the conflict target nor overwritten', { table: tableName, column: key });
      }
    }
    for (const key of overwrite.columns) {
      if (row[key] === undefined) {
        throw newError('An overwritten column is missing from a row', { table: tableName, column: key });
      }
    }
  }
};

/**
 * The same insert the `values()` path would run, fed by one jsonb parameter. `securedSetWhere`
 * already carries the update policies, so the conflict-triggered UPDATE stays as narrow here as
 * it is there.
 */
const jsonPayloadInsert = <T extends AnyTable>(
  table: T,
  plan: JsonPayloadPlan,
  conflict: RenderedConflictConfig<T> | undefined,
  securedSetWhere: SQL | undefined,
  returningAll: boolean,
): SQL | null => {
  const tail = returningAll ? sql` returning *` : sql.empty();
  const columnList = sql.join(plan.columns.map((column) => sql.identifier(column.name)), sql`, `);
  const recordDefinition = sql.join(
    plan.columns.map((column) => sql`${sql.identifier(column.name)} ${sql.raw(column.getSQLType())}`),
    sql`, `,
  );
  const selectList = sql.join(
    plan.columns.map((column) => sql`payload.${sql.identifier(column.name)}`),
    sql`, `,
  );
  const head = sql`insert into ${table} (${columnList}) select ${selectList} from jsonb_to_recordset(${plan.payload}::jsonb) as payload(${recordDefinition})`;

  if (conflict === undefined) {
    return sql`${head}${tail}`;
  }
  if (conflict.type === 'doNothing') {
    const target = conflict.config?.target;
    return sql`${head} on conflict ${target ? sql`(${conflictTargetList(target)}) ` : sql.empty()}${conflict.config?.where ? sql`where ${conflict.config.where} ` : sql.empty()}do nothing${tail}`;
  }
  const setClause = conflictSetClause(table, conflict.config.set);
  if (setClause === null) {
    return null;
  }
  return sql`${head} on conflict (${conflictTargetList(conflict.config.target)}) ${conflict.config.targetWhere ? sql`where ${conflict.config.targetWhere} ` : sql.empty()}do update set ${setClause}${securedSetWhere ? sql` where ${securedSetWhere}` : sql.empty()}${tail}`;
};

/** Returned rows come back as the driver shaped them, where `returning()` hands back column types. */
const mapReturnedRows = <T extends AnyTable>(
  table: T,
  rows: Array<Record<string, unknown>>,
): Array<T['$inferSelect']> => {
  const tableColumns = getTableColumns(table) as Record<string, PgColumn>;
  return rows.map((row) => {
    const mapped: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(tableColumns)) {
      const value = row[column.name];
      mapped[key] = value === null || value === undefined ? null : column.mapFromDriverValue(value);
    }
    return mapped;
  });
};

type WriteOperations = {
  insert: <T extends AnyTable>(table: T) => ProtectedInsertBuilder<T>,
  update: <T extends AnyTable>(table: T) => ProtectedUpdateBuilder<T>,
  delete: <T extends AnyTable>(table: T) => ProtectedDeleteBuilder<T>,
};

/** ReadonlyDrizzle with protected insert/update/delete enforced by security policies */
export type ProtectedDB = ReadonlyDrizzle & WriteOperations;
export type ProtectedTransaction = ReadonlyTransaction & WriteOperations;

const createWriteOperations = (
  db: DrizzleDB | Transaction,
  atomic: <T>(callback: (tx: Transaction) => Promise<T>) => Promise<T>,
  eventOrigin: EventOrigin,
  options: ProtectedDBOptions,
): WriteOperations => {
  const minRows = options.jsonPayloadMinRows ?? JSON_PAYLOAD_MIN_ROWS;
  const reportPath = (decision: InsertPathDecision) => options.onInsertPath?.(decision);

  const getWriteSecurityConditions = <T extends AnyTable>(
    table: T,
    action: 'update' | 'delete',
  ): Array<SQL> => {
    const policies = getSecurityPolicies(table);
    const conditions: Array<SQL> = [];

    for (const policy of policies) {
      const rule = policy[action] || policy.read;
      if (rule) {
        const condition = rule(eventOrigin, table);
        if (condition) {
          conditions.push(condition);
        }
      }
    }
    return conditions;
  };

  /**
   * Only a job origin: its runs are the observed ones. The predicate the policies add is rendered
   * and compared with the overwrite key equalities rather than assumed, so a clause added to an
   * update rule later fails the certification instead of the invariant.
   */
  const isCertifiableOverwrite = <T extends AnyTable>(
    table: T,
    target: IndexColumn | Array<IndexColumn>,
    policies: Array<SecurityPolicyRule<T>>,
    securedSetWhere: SQL | undefined,
  ): boolean => {
    if (eventOrigin.type !== 'job' || policies.length === 0 || securedSetWhere === undefined) {
      return false;
    }
    const targetColumns = (Array.isArray(target) ? target : [target]).filter((column) => is(column, PgColumn));
    const keys: Array<PgColumn> = [];
    for (const policy of policies) {
      const key = policy.overwriteKey?.(table);
      if (key === undefined || !targetColumns.includes(key)) {
        return false;
      }
      keys.push(key);
    }
    const tenantId = eventOrigin.tenantId;
    const expected = and(...keys.map((key) => eq(key, tenantId)));
    const render = (condition: SQL): string => {
      const query = insertPolicyDialect.sqlToQuery(condition);
      return `${query.sql} ${JSON.stringify(query.params)}`;
    };
    return expected !== undefined && render(securedSetWhere) === render(expected);
  };

  const executeInsert = async <T extends AnyTable>(config: InsertQueryConfig<T>) => {
    const { table, values: rows, returningAll } = config;
    if (rows.length === 0) {
      return returningAll ? [] : undefined;
    }

    const policies = getSecurityPolicies(table);
    const overwrite = config.conflict?.type === 'doOverwrite' ? config.conflict.config : undefined;
    if (overwrite !== undefined) {
      assertOverwriteShape(table, overwrite, rows as Array<Record<string, unknown>>);
    }
    const conflict: RenderedConflictConfig<T> | undefined = overwrite === undefined
      ? (config.conflict as RenderedConflictConfig<T> | undefined)
      : { type: 'doUpdate', config: { target: overwrite.target, set: overwriteSet(table, overwrite.columns) } };

    return atomic(async (tx) => {
      await tagTransaction(tx, eventOrigin);
      for (const policy of policies) {
        if (policy.create) {
          // The rule is asked about every row, since that is where it rejects one addressed to
          // another tenant, but it usually answers the same condition.
          const confirmed = new Set<string>();
          for (const row of rows) {
            const condition = policy.create(eventOrigin, row);
            if (!condition) {
              continue;
            }
            const query = insertPolicyDialect.sqlToQuery(condition);
            const key = `${query.sql}\u0000${JSON.stringify(query.params)}`;
            if (confirmed.has(key)) {
              continue;
            }
            const result = await tx.execute(sql`select 1 where ${condition}`);
            if (result.rowCount === 0) {
              throw new Error('Access Denied');
            }
            confirmed.add(key);
          }
        }
      }
      // Enforce update policies on the conflict-triggered UPDATE
      const updateConditions = conflict?.type === 'doUpdate'
        ? getWriteSecurityConditions(table, 'update')
        : [];
      const securedSetWhere = conflict?.type === 'doUpdate' && updateConditions.length > 0
        ? and(conflict.config.setWhere, ...updateConditions)
        : conflict?.type === 'doUpdate' ? conflict.config.setWhere : undefined;

      // `returning` would hand back the columns the overwrite did not assign, which are the stored row's.
      const certified = overwrite !== undefined && !returningAll
        && isCertifiableOverwrite(table, overwrite.target, policies, securedSetWhere);

      // Only a statement this writer renders can carry the marker, so a certified overwrite takes
      // the payload path at any size and cannot fall back.
      const planned = planJsonPayload(table, rows, certified ? 1 : minRows);
      if (!isPlan(planned)) {
        if (certified) {
          throw newError('A certified overwrite could not be rendered on the payload path', { table: getTableName(table), reason: 'reason' in planned ? planned.reason : planned.path });
        }
        reportPath(planned);
      } else {
        const statement = jsonPayloadInsert(table, planned, conflict, securedSetWhere, returningAll);
        if (statement === null) {
          if (certified) {
            throw newError('A certified overwrite could not be rendered on the payload path', { table: getTableName(table), reason: 'unsupported-conflict-set' });
          }
          reportPath({ path: 'values', reason: 'unsupported-conflict-set' });
        } else {
          reportPath({ path: 'json-payload' });
          const result = await tx.execute(certified ? sql`${sql.raw(OVERWRITE_MARKER)} ${statement}` : statement);
          return returningAll ? mapReturnedRows(table, result.rows) : undefined;
        }
      }

      let query = tx.insert(table).values(rows).$dynamic();

      if (conflict?.type === 'doNothing') {
        query = query.onConflictDoNothing(conflict.config);
      } else if (conflict?.type === 'doUpdate') {
        query = query.onConflictDoUpdate({ ...conflict.config, setWhere: securedSetWhere });
      }

      if (returningAll) {
        return query.returning();
      }

      return query;
    });
  };

  // An update or delete made inside a run needs a transaction to carry the tag — including one a
  // handler makes under its caller's authorization, which is why this asks for the tag rather than
  // for the origin's type. Everything else keeps the single-statement path.
  const withWriteTransaction = async <R>(run: (target: DrizzleDB | Transaction) => Promise<R>): Promise<R> => {
    if (!originJobTag(eventOrigin)) {
      return run(db);
    }
    return atomic(async (tx) => {
      await tagTransaction(tx, eventOrigin);
      return run(tx);
    });
  };

  const executeUpdate = async <T extends AnyTable>(config: UpdateQueryConfig<T>) => {
    const { table, values, where, returningAll } = config;
    return withWriteTransaction(async (target) => {
      const query = target.update(table)
        .set(values)
        .where(and(where, ...getWriteSecurityConditions(table, 'update')));

      if (returningAll) {
        return query.returning();
      }

      return query;
    });
  };

  const executeDelete = async <T extends AnyTable>(config: DeleteQueryConfig<T>) => {
    const { table, where, returningAll } = config;
    return withWriteTransaction(async (target) => {
      const query = target.delete(table)
        .where(and(where, ...getWriteSecurityConditions(table, 'delete')));

      if (returningAll) {
        return query.returning();
      }

      return query;
    });
  };

  return {
    insert: <T extends AnyTable>(table: T): ProtectedInsertBuilder<T> => ({
      values: (values: T['$inferInsert'] | Array<T['$inferInsert']>) => {
        const rows = Array.isArray(values) ? values : [values];
        return createInsertQuery<T, void>(
          { table, values: rows, returningAll: false },
          executeInsert,
        );
      },
    }),

    update: <T extends AnyTable>(table: T): ProtectedUpdateBuilder<T> => ({
      set: (values: Partial<T['$inferInsert']>) => ({
        where: (condition: SQL | undefined) => createWhereQuery<T, UpdateQueryConfig<T>, void>(
          { table, values, where: condition, returningAll: false },
          executeUpdate,
        ),
      }),
    }),

    delete: <T extends AnyTable>(table: T): ProtectedDeleteBuilder<T> => ({
      where: (condition: SQL | undefined) => createWhereQuery<T, DeleteQueryConfig<T>, void>(
        { table, where: condition, returningAll: false },
        executeDelete,
      ),
    }),
  };
};

const BLOCKED_METHODS = new Set([
  'execute',
  'transaction',
  'refreshMaterializedView',
  'with',
  '$with',
]);

export const createProtectedDB = (
  rawDb: DrizzleDB | Transaction,
  atomic: <T>(callback: (tx: Transaction) => Promise<T>) => Promise<T>,
  eventOrigin: EventOrigin,
  options: ProtectedDBOptions = {},
): ProtectedDB => {
  const ops = createWriteOperations(rawDb, atomic, eventOrigin, options);
  return new Proxy(rawDb as any, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') {
        if (prop in ops) {
          return ops[prop as keyof WriteOperations];
        }
        if (BLOCKED_METHODS.has(prop)) {
          throw new Error(`ProtectedDB: '${prop}' is not allowed. Use rawDb() for justified bypasses.`);
        }
      }
      return Reflect.get(target, prop, receiver);
    },
  });
};

/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion */
