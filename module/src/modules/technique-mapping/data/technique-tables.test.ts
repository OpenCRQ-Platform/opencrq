import { describe, expect, it } from 'vitest';
import {
  CITED_TECHNIQUE_EXTERNAL_IDS,
  CURATED_TECHNIQUE_MAPPINGS,
  MAPPING_ROLES,
  RETIRED_TECHNIQUE_EXTERNAL_IDS,
  TECHNIQUE_TABLES_PROVENANCE,
  UNRESOLVED_TECHNIQUE_EXTERNAL_IDS,
} from './index';

/**
 * The counts the generator asserts on its own side, pinned again here so that a regeneration that
 * silently loses rows fails the product build rather than shipping a thinner table.
 */
const CURATED_VULNERABILITIES = 419;
const CURATED_ROWS = 1183;
const CURATED_ROWS_BY_ROLE = { exploitation_technique: 460, primary_impact: 407, secondary_impact: 316 };

const curatedRows = Object.values(CURATED_TECHNIQUE_MAPPINGS)
  .flatMap((byRole) => MAPPING_ROLES.flatMap((role) => [...byRole[role]]));

describe('the vendored technique tables', () => {
  it('cites only techniques the product catalogue carries', () => {
    expect(UNRESOLVED_TECHNIQUE_EXTERNAL_IDS).toEqual([]);
  });

  it('cites no technique the product catalogue has retired', () => {
    expect(RETIRED_TECHNIQUE_EXTERNAL_IDS).toEqual([]);
  });

  it('cites at least one technique', () => {
    expect(CITED_TECHNIQUE_EXTERNAL_IDS.length).toBeGreaterThan(0);
  });
});

describe('CURATED_TECHNIQUE_MAPPINGS', () => {
  it('carries the published corpus row for row', () => {
    expect(Object.keys(CURATED_TECHNIQUE_MAPPINGS)).toHaveLength(CURATED_VULNERABILITIES);
    expect(curatedRows).toHaveLength(CURATED_ROWS);
  });

  it('keeps the three roles apart, since a consumer joins per role', () => {
    for (const role of MAPPING_ROLES) {
      const rows = Object.values(CURATED_TECHNIQUE_MAPPINGS).flatMap((byRole) => [...byRole[role]]);
      expect(rows).toHaveLength(CURATED_ROWS_BY_ROLE[role]);
    }
  });

  it('names no technique twice under one role', () => {
    for (const [cveId, byRole] of Object.entries(CURATED_TECHNIQUE_MAPPINGS)) {
      for (const role of MAPPING_ROLES) {
        expect(new Set(byRole[role]).size, `${cveId} ${role}`).toBe(byRole[role].length);
      }
    }
  });
});

describe('TECHNIQUE_TABLES_PROVENANCE', () => {
  it('names every source it was built from, with its digest', () => {
    expect(TECHNIQUE_TABLES_PROVENANCE.sources).toHaveLength(2);
    for (const source of TECHNIQUE_TABLES_PROVENANCE.sources) {
      expect(source.id).not.toBe('');
      expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('carries a tables version and a generation date as data values', () => {
    expect(TECHNIQUE_TABLES_PROVENANCE.tablesVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(TECHNIQUE_TABLES_PROVENANCE.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('agrees with the tables it describes', () => {
    expect(TECHNIQUE_TABLES_PROVENANCE.curatedVulnerabilityCount).toBe(Object.keys(CURATED_TECHNIQUE_MAPPINGS).length);
    expect(TECHNIQUE_TABLES_PROVENANCE.curatedRowCount).toBe(curatedRows.length);
  });

  it('records every retirement it rewrote and every one it could not', () => {
    for (const rewrite of TECHNIQUE_TABLES_PROVENANCE.rewrittenTechniques) {
      expect(rewrite.from).toMatch(/^T\d{4}(\.\d{3})?$/);
      expect(rewrite.to).toMatch(/^T\d{4}(\.\d{3})?$/);
      expect(CITED_TECHNIQUE_EXTERNAL_IDS).not.toContain(rewrite.from);
    }
    for (const dropped of TECHNIQUE_TABLES_PROVENANCE.droppedTechniques) {
      expect(CITED_TECHNIQUE_EXTERNAL_IDS).not.toContain(dropped);
    }
  });

  it('carries the upstream attribution the licence asks for', () => {
    expect(TECHNIQUE_TABLES_PROVENANCE.license).toContain('Apache 2.0');
    expect(TECHNIQUE_TABLES_PROVENANCE.license).toContain('MITRE');
  });
});
