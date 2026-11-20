import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../../setup/db';
import { takeSingleConnectionViolations } from '../../setup/single-connection-guard';

describe('single connection guard', () => {
  it('records a query sent while the transaction still runs another, with its SQL', async () => {
    await db.transaction(async (tx) => {
      await Promise.all([tx.execute(sql`SELECT pg_sleep(0.05)`), tx.execute(sql`SELECT 2 AS second_query`)]);
    });

    const violations = takeSingleConnectionViolations();
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('second_query');
  });

  it('records nothing when the transaction runs its queries one after the other', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_sleep(0.05)`);
      await tx.execute(sql`SELECT 1`);
    });

    expect(takeSingleConnectionViolations()).toEqual([]);
  });

  it('records nothing for concurrent queries on the pool, which gives each its own connection', async () => {
    await Promise.all([db.execute(sql`SELECT pg_sleep(0.05)`), db.execute(sql`SELECT 1`)]);

    expect(takeSingleConnectionViolations()).toEqual([]);
  });
});
