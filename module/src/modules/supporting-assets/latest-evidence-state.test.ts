import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { verdictState } from './latest-evidence-state';

describe('verdictState', () => {
  const rendered = new PgDialect().sqlToQuery(verdictState(sql`verdict.is_exposed`)).sql;

  it('should map exposed to applicable and not exposed to dismissed', () => {
    expect(rendered).toContain('when verdict.is_exposed then \'applicable\'');
    expect(rendered).toContain('when not verdict.is_exposed then \'dismissed\'');
  });

  it('should leave a missing verdict without a state, so a read that forgets to exclude it counts it as nothing', () => {
    expect(rendered).not.toMatch(/\belse\b/i);
  });
});
