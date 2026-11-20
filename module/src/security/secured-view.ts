/*
 * Drizzle ORM's table type system requires `any` in generic type parameters
 * (e.g., PgTableWithColumns<any>, PgUUID<any>). These are structural requirements
 * of the Drizzle API surface, not unsafe runtime usages.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion */
import { newError } from '@app/utils';
import { and, getTableColumns, getTableName, isTable } from 'drizzle-orm';
import type { Subquery } from 'drizzle-orm';
import type { PgTableWithColumns } from 'drizzle-orm/pg-core';
import type { DrizzleDB } from '../db';
import type { EventOrigin, GatekeeperResult } from './policy';
import { schema } from '../modules';
import { getSecurityPolicies } from './policy';

type SecuredView<T extends PgTableWithColumns<any>> =
  Subquery<T['_']['name'], T['_']['columns']> & T['_']['columns'];

const createSecuredView = <T extends PgTableWithColumns<any>>(
  db: DrizzleDB,
  origin: EventOrigin,
  table: T,
): SecuredView<T> => {
  const policies = getSecurityPolicies(table);

  const conditions: Array<GatekeeperResult> = [];

  for (const policy of policies) {
    if (policy.read) {
      const condition = policy.read(origin, table);
      if (condition) {
        conditions.push(condition);
      }
    }
  }

  return db.select(getTableColumns(table))
    // @ts-ignore : Drizzle typing quirks on dynamic from
    .from(table)
    .where(and(...conditions))
    .as(getTableName(table));
};

type SchemaType = typeof schema;

type TableKeys<S> = {
  [K in keyof S]: S[K] extends PgTableWithColumns<any> ? K : never;
}[keyof S];

export type SecuredSchema = {
  [K in TableKeys<SchemaType>]: SecuredView<SchemaType[K]>
}

export const createSecuredSchema = (
  db: DrizzleDB,
  origin: EventOrigin,
): SecuredSchema => {
  const viewCache = new Map<keyof SchemaType, any>();

  return new Proxy({} as SecuredSchema, {
    get(_target, prop, _receiver) {
      const tableName = String(prop);
      if (!(tableName in schema)) {
        throw newError('Invalid Secured Schema', { tableName });
      }

      const tableKey = tableName as keyof SchemaType;
      if (viewCache.has(tableKey)) {
        return viewCache.get(tableKey);
      }

      const table = schema[tableKey];

      if (!table || !isTable(table)) {
        return undefined;
      }

      const securedView = createSecuredView(db, origin, table as PgTableWithColumns<any>);

      viewCache.set(tableKey, securedView);

      return securedView;
    },
  });
};

/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion */
