import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { assetEnumerations, assetEvidenceSources } from '../modules/supporting-assets/schema';
import { dataChanges, updatedAtOnDataChange, valuesChange } from './write-guards';

const render = (fragment: SQL) => new PgDialect().sqlToQuery(fragment);

const set = {
  scope: sql`excluded.scope`,
  lastSeenAt: sql`excluded.last_seen_at`,
  updatedAt: sql`now()`,
};

describe('valuesChange', () => {
  it('should compare every column of the set but updated_at, in the order of the set', () => {
    expect(render(valuesChange(assetEvidenceSources, set)).sql).toBe(
      '("asset_evidence_sources"."scope", "asset_evidence_sources"."last_seen_at") is distinct from (excluded.scope, excluded.last_seen_at)',
    );
  });

  it('should bind a plain value as a parameter', () => {
    const { sql: text, params } = render(valuesChange(assetEvidenceSources, { scope: 'scenario-1' }));

    expect(text).toBe('("asset_evidence_sources"."scope") is distinct from ($1)');
    expect(params).toEqual(['scenario-1']);
  });

  it('should render false when the set holds nothing but updated_at', () => {
    expect(render(valuesChange(assetEvidenceSources, { updatedAt: sql`now()` })).sql).toBe('false');
  });

  it('should throw on a key the table has no column for', () => {
    expect(() => valuesChange(assetEvidenceSources, { nope: sql`1` })).toThrow();
  });
});

describe('dataChanges', () => {
  it('should leave out the sync dates as well as updated_at', () => {
    expect(render(dataChanges(assetEvidenceSources, set)).sql).toBe(
      '("asset_evidence_sources"."scope") is distinct from (excluded.scope)',
    );
  });

  it('should render false when only sync dates and updated_at are left', () => {
    const syncDatesOnly = { lastSeenAt: sql`excluded.last_seen_at`, lastReportedAt: sql`now()`, updatedAt: sql`now()` };

    expect(render(dataChanges(assetEvidenceSources, syncDatesOnly)).sql).toBe('false');
  });

  it('should throw on a key the table has no column for', () => {
    expect(() => dataChanges(assetEvidenceSources, { nope: sql`1` })).toThrow();
  });
});

describe('updatedAtOnDataChange', () => {
  it('should move updated_at to now() only when the data changes', () => {
    expect(render(updatedAtOnDataChange(assetEvidenceSources, set)).sql).toBe(
      'case when ("asset_evidence_sources"."scope") is distinct from (excluded.scope) then now() else "asset_evidence_sources"."updated_at" end',
    );
  });

  it('should move updated_at to the given instant, bound as a parameter, instead of now()', () => {
    const at = new Date('2026-11-06T10:00:00.123Z');
    const { sql: text, params } = render(updatedAtOnDataChange(assetEvidenceSources, { scope: sql`excluded.scope` }, at));

    expect(text).toBe(
      'case when ("asset_evidence_sources"."scope") is distinct from (excluded.scope) then $1 else "asset_evidence_sources"."updated_at" end',
    );
    expect(params).toEqual([at.toISOString()]);
  });

  it('should keep updated_at as it is when no data column is in the set', () => {
    const syncDatesOnly = { lastSeenAt: sql`excluded.last_seen_at`, lastReportedAt: sql`now()` };

    expect(render(updatedAtOnDataChange(assetEvidenceSources, syncDatesOnly)).sql).toBe(
      'case when false then now() else "asset_evidence_sources"."updated_at" end',
    );
  });

  it('should throw on a table with no updated_at column', () => {
    expect(() => updatedAtOnDataChange(assetEnumerations, { scope: sql`excluded.scope` })).toThrow();
  });

  it('should throw on a key the table has no column for', () => {
    expect(() => updatedAtOnDataChange(assetEvidenceSources, { nope: sql`1` })).toThrow();
  });
});
