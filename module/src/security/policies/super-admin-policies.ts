import { and, eq, exists, getTableName, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { users } from '../../modules';

/**
 * Whether the user is the super administrator XTM One designates (`users.is_super_admin`, set and
 * cleared at every sign-in), who holds every right in every tenant and on the platform without a
 * membership or a platform group.
 *
 * It names no column of the row being filtered, so Postgres evaluates it once per statement rather
 * than per row, which keeps a tenant-wide read parallel: OR it beside a membership or capability
 * check, never inside one. Aliased because the secured view of `users` is itself named `users`, and
 * built inside the function for the import cycle `ownedByTenant` documents.
 */
export const userIsSuperAdmin = (userId: string): SQL => {
  const account = alias(users, 'super_admin_account');
  return exists(
    sql`(select 1 from ${users} as ${sql.raw(getTableName(account))} where ${and(
      eq(account.id, userId),
      eq(account.isSuperAdmin, true),
    )})`,
  );
};
