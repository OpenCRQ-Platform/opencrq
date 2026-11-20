import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { inUuids, notInUuids } from './uuid-array';

const dialect = new PgDialect();
const ids = Array.from({ length: 70_000 }, (_, index) => `00000000-0000-7000-8000-${index.toString().padStart(12, '0')}`);

describe('inUuids', () => {
  it('binds a list past the bind-parameter limit as a single parameter', () => {
    const query = dialect.sqlToQuery(inUuids(sql.identifier('id'), ids));

    expect(query.sql).toBe('"id" = any($1::uuid[])');
    expect(query.params).toEqual([ids]);
  });
});

describe('notInUuids', () => {
  it('binds a list past the bind-parameter limit as a single parameter', () => {
    const query = dialect.sqlToQuery(notInUuids(sql.identifier('id'), ids));

    expect(query.sql).toBe('"id" <> all($1::uuid[])');
    expect(query.params).toEqual([ids]);
  });
});
