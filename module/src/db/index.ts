import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../modules/schema';

export * from './run-migrations';
export * from './seed';
export * from './migration-conventions';
export * from './statement-observation';
export * from './doorbell-topology';
export * from './write-guards';
export * from './row-diff';
export * from './journal-value';

export type DrizzleDB = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<DrizzleDB['transaction']>[0]>[0];

/** DrizzleDB with write methods stripped — forces reads through views and writes through writer */
export type ReadonlyDrizzle = Omit<DrizzleDB, 'insert' | 'update' | 'delete' | 'transaction' | 'execute' | 'refreshMaterializedView'>;
export type ReadonlyTransaction = Omit<Transaction, 'insert' | 'update' | 'delete' | 'execute'>;

/** ReadonlyDrizzle with protected write methods (insert/update/delete enforced by security policies) */
export type { ProtectedDB, ProtectedTransaction } from '../security/writer';
