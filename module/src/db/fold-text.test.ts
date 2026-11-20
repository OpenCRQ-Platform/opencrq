import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { cve } from '../modules/cve/schema';
import { groups } from '../modules/groups/schema';
import { foldedLike, orderByFolded } from './fold-text';

const render = (fragment: SQL) => new PgDialect().sqlToQuery(fragment);

describe('foldedLike', () => {
  it('should read the stored folded column and fold only the bound contains pattern', () => {
    const query = render(foldedLike(cve.cveTitleFolded, 'a%_b', 'contains'));
    expect(query.sql).toBe('"cve"."cve_title_folded" like fold_text($1)');
    expect(query.params).toEqual(['%a\\%\\_b%']);
  });

  it('should bind the escaped prefix pattern', () => {
    const query = render(foldedLike(cve.cveTitleFolded, 'a%_b', 'prefix'));
    expect(query.sql).toBe('"cve"."cve_title_folded" like fold_text($1)');
    expect(query.params).toEqual(['a\\%\\_b%']);
  });
});

describe('orderByFolded', () => {
  it('should leave a NOT NULL column in the default nulls order', () => {
    const [folded, tieBreak] = orderByFolded(groups.nameFolded, groups.name, false);
    expect(render(folded).sql).toBe('"groups"."name_folded" asc');
    expect(render(tieBreak).sql).toBe('"groups"."name" collate "C" asc');
    const [foldedDesc, tieBreakDesc] = orderByFolded(groups.nameFolded, groups.name, true);
    expect(render(foldedDesc).sql).toBe('"groups"."name_folded" desc');
    expect(render(tieBreakDesc).sql).toBe('"groups"."name" collate "C" desc');
  });

  it('should put the missing values of a nullable column last on both members', () => {
    const [folded, tieBreak] = orderByFolded(cve.cveTitleFolded, cve.cveTitle, false);
    expect(render(folded).sql).toBe('"cve"."cve_title_folded" asc nulls last');
    expect(render(tieBreak).sql).toBe('"cve"."cve_title" collate "C" asc nulls last');
    const [foldedDesc, tieBreakDesc] = orderByFolded(cve.cveTitleFolded, cve.cveTitle, true);
    expect(render(foldedDesc).sql).toBe('"cve"."cve_title_folded" desc nulls last');
    expect(render(tieBreakDesc).sql).toBe('"cve"."cve_title" collate "C" desc nulls last');
  });
});
