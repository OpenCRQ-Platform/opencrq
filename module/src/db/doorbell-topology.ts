import { newError } from '@app/utils';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/** A child table whose doorbell finds its tenant through `parent`, and therefore rings nothing
 * once the parent row is gone: a CASCADE from the parent deletes the child rows in silence. The
 * parent is tenant-scoped, so a change of the child rings for the parent row's tenant. */
export interface DoorbellParent {
  child: string,
  parent: string,
}

/**
 * Where each tenant-through-another-table function names that table: in a trigger argument for the
 * two generic ones, in the body for the hard-coded one.
 */
const PARENT_OF: Record<string, { argIndex: number } | { table: string }> = {
  notify_data_changed_tenant_via_fk: { argIndex: 1 },
  notify_data_changed_tenant_via_2hop_fk: { argIndex: 1 },
  notify_data_changed_tenant_via_crq_run: { table: 'crq_indicator_runs' },
};

interface TriggerRow {
  [column: string]: unknown,
  child: string,
  fn: string,
  args: string | null,
}

/** `encode(tgargs, 'escape')` renders the NUL that ends each argument as the four characters `\000`. */
export const decodeTriggerArgs = (args: string | null): Array<string> => (args ?? '').split('\\000').filter((arg) => arg.length > 0);

export const loadDoorbellParents = async (db: Pick<NodePgDatabase, 'execute'>): Promise<Array<DoorbellParent>> => {
  const result = await db.execute<TriggerRow>(sql`
    SELECT c.relname AS child, p.proname AS fn, encode(t.tgargs, 'escape') AS args
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal AND p.proname LIKE 'notify_data_changed_tenant_via_%'
    ORDER BY c.relname
  `);
  return result.rows.map((row) => {
    const rule = PARENT_OF[row.fn];
    if (rule === undefined) {
      throw newError('Doorbell function looks the tenant up through an unknown table', { child: row.child, fn: row.fn });
    }
    const parent = 'table' in rule ? rule.table : decodeTriggerArgs(row.args)[rule.argIndex];
    if (parent === undefined) {
      throw newError('Doorbell trigger carries no parent table argument', { child: row.child, fn: row.fn, args: row.args });
    }
    return { child: row.child, parent };
  });
};

export interface DoorbellTopology {
  /**
   * The tables a write to `table` changes: itself, plus on a DELETE every table hanging under it,
   * whose own doorbell the CASCADE silences. Only a DELETE: an UPDATE of the parent touches no
   * child row, and an INSERT creates none.
   */
  tablesChangedBy: (table: string, op: string | null | undefined) => Set<string>,
}

export const createDoorbellTopology = (parents: ReadonlyArray<DoorbellParent>): DoorbellTopology => {
  const childrenOf = new Map<string, Set<string>>();
  for (const { child, parent } of parents) {
    const children = childrenOf.get(parent) ?? new Set<string>();
    children.add(child);
    childrenOf.set(parent, children);
  }
  return {
    tablesChangedBy: (table, op) => {
      const tables = new Set([table]);
      if (op !== 'DELETE') {
        return tables;
      }
      const frontier = [table];
      for (let next = frontier.pop(); next !== undefined; next = frontier.pop()) {
        for (const child of childrenOf.get(next) ?? []) {
          if (!tables.has(child)) {
            tables.add(child);
            frontier.push(child);
          }
        }
      }
      return tables;
    },
  };
};
