import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { cve } from '../modules/cve/schema';
import { orderNullsLast } from './order-nulls-last';

const render = (fragment: SQL) => new PgDialect().sqlToQuery(fragment).sql;

describe('orderNullsLast', () => {
  it('should leave a NOT NULL column in the default nulls order', () => {
    expect(render(orderNullsLast(cve.updatedAt, true))).toBe('"cve"."updated_at" desc');
    expect(render(orderNullsLast(cve.updatedAt, false))).toBe('"cve"."updated_at" asc');
  });

  it('should put the missing values of a nullable column last in both directions', () => {
    expect(render(orderNullsLast(cve.epss, true))).toBe('"cve"."epss" desc nulls last');
    expect(render(orderNullsLast(cve.epss, false))).toBe('"cve"."epss" asc nulls last');
  });

  it('should put the missing values of an expression last, a NOT NULL column wrapped in one included', () => {
    expect(render(orderNullsLast(sql`${cve.updatedAt}`, true))).toBe('"cve"."updated_at" desc nulls last');
  });
});
