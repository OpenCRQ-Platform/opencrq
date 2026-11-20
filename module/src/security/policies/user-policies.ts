import { eq, sql } from 'drizzle-orm';
import type { PgTableWithColumns, PgUUID } from 'drizzle-orm/pg-core';
import type { EventOrigin, GatekeeperResult, SecurityPolicyRule } from '../policy';

/* eslint-disable @typescript-eslint/no-explicit-any -- Drizzle: PgTableWithColumns and PgUUID require `any` type parameters */
export type TableWithUserIdUUID = PgTableWithColumns<any> & {
  userId: PgUUID<any>,
};
/* eslint-enable @typescript-eslint/no-explicit-any */

const userOwnershipRule: (origin: EventOrigin, table: TableWithUserIdUUID) => GatekeeperResult = (origin, table) => {
  switch (origin.type) {
    case 'auth':
    case 'system':
      return undefined;
    case 'connector':
    case 'job':
      return sql`false`;
    case 'client':
    case 'platform':
      return eq(table.userId, origin.userId);
  }
};

export const userOwnershipPolicy: SecurityPolicyRule<TableWithUserIdUUID> = {
  read: userOwnershipRule,
};

const ownRowsRule = (origin: EventOrigin, table: TableWithUserIdUUID): GatekeeperResult => {
  switch (origin.type) {
    case 'auth':
    case 'system':
      return undefined;
    case 'connector':
    case 'job':
    case 'platform':
      return sql`false`;
    case 'client':
      return eq(table.userId, origin.userId);
  }
};

/** Only the row's user reads or writes it, never a connector or a job on their behalf. */
export const userOwnedRowsPolicy: SecurityPolicyRule<TableWithUserIdUUID> = {
  read: ownRowsRule,
  update: ownRowsRule,
  delete: ownRowsRule,
  create: (origin, values) => {
    switch (origin.type) {
      case 'auth':
      case 'system':
        return undefined;
      case 'connector':
      case 'job':
      case 'platform':
        return sql`false`;
      case 'client':
        return values.userId === origin.userId ? undefined : sql`false`;
    }
  },
};
