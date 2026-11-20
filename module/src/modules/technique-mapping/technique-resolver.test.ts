import { describe, expect, it } from 'vitest';
import type { TechniquesByRole } from './data/curated-technique-mappings';
import type { ResolverTables } from './technique-resolver';
import { keepStrongestLane, resolveTechniques, resolveTechniquesWith } from './technique-resolver';

const byRole = (techniques: Partial<TechniquesByRole>): TechniquesByRole => ({
  exploitation_technique: techniques.exploitation_technique ?? [],
  primary_impact: techniques.primary_impact ?? [],
  secondary_impact: techniques.secondary_impact ?? [],
});

const SYNTHETIC_TABLES: ResolverTables = {
  curated: {
    'CVE-9000-0001': byRole({ exploitation_technique: ['T1000'], primary_impact: ['T2000'], secondary_impact: ['T3000'] }),
    'CVE-9000-0002': byRole({ exploitation_technique: ['T9001'] }),
  },
};

describe('the curated lane', () => {
  it('carries the published roles through unchanged', () => {
    const rows = resolveTechniquesWith({ cveId: 'CVE-9000-0001' }, SYNTHETIC_TABLES);
    expect(rows).toEqual([
      { techniqueExternalId: 'T1000', role: 'exploitation_technique', lane: 'curated' },
      { techniqueExternalId: 'T2000', role: 'primary_impact', lane: 'curated' },
      { techniqueExternalId: 'T3000', role: 'secondary_impact', lane: 'curated' },
    ]);
  });

  it('resolves a vulnerability the table does not name to nothing on its own', () => {
    expect(resolveTechniquesWith({ cveId: 'CVE-9000-9999' }, SYNTHETIC_TABLES)).toEqual([]);
  });

  it('yields identical rows in identical order on every run', () => {
    const input = { cveId: 'CVE-9000-0001' };
    expect(resolveTechniquesWith(input, SYNTHETIC_TABLES)).toEqual(resolveTechniquesWith(input, SYNTHETIC_TABLES));
  });
});

describe('keepStrongestLane', () => {
  it('keeps the strongest lane when two name the same technique in the same role', () => {
    const shared = keepStrongestLane([
      { techniqueExternalId: 'T1000', role: 'exploitation_technique', lane: 'structural' },
      { techniqueExternalId: 'T1000', role: 'exploitation_technique', lane: 'curated' },
      { techniqueExternalId: 'T1000', role: 'primary_impact', lane: 'structural' },
    ] as const);
    expect(shared).toEqual([
      { techniqueExternalId: 'T1000', role: 'exploitation_technique', lane: 'curated' },
      { techniqueExternalId: 'T1000', role: 'primary_impact', lane: 'structural' },
    ]);
  });
});

describe('the supplied lane', () => {
  it('is the whole answer, silencing every derived lane', () => {
    const rows = resolveTechniquesWith(
      { cveId: 'CVE-9000-0001', supplied: [{ techniqueExternalId: 'T8000', role: 'primary_impact' }] },
      SYNTHETIC_TABLES,
    );
    expect(rows).toEqual([{ techniqueExternalId: 'T8000', role: 'primary_impact', lane: 'supplied' }]);
  });

  it('gives a row stating no role the exploitation role', () => {
    const rows = resolveTechniquesWith(
      { cveId: 'CVE-9000-9999', supplied: [{ techniqueExternalId: 'T8000' }] },
      SYNTHETIC_TABLES,
    );
    expect(rows).toEqual([{ techniqueExternalId: 'T8000', role: 'exploitation_technique', lane: 'supplied' }]);
  });

  it('lets the derived lanes run when no row is supplied', () => {
    const rows = resolveTechniquesWith({ cveId: 'CVE-9000-0001', supplied: [] }, SYNTHETIC_TABLES);
    expect(rows.map((row) => row.lane)).toEqual(['curated', 'curated', 'curated']);
  });
});

describe('against the vendored tables', () => {
  // Read through at display and scoring time, so nothing the tenant can edit is ever stored.
  it('writes no row from a weakness class', () => {
    const rows = resolveTechniques({ cveId: 'CVE-2021-44228' });
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.lane))).toEqual(new Set(['curated']));
  });

  it('names a technique at most once per role', () => {
    const rows = resolveTechniques({ cveId: 'CVE-2021-44228' });
    const pairs = rows.map((row) => `${row.techniqueExternalId}|${row.role}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('resolves a vulnerability with no curated entry to nothing', () => {
    expect(resolveTechniques({ cveId: 'CVE-2024-6387' })).toEqual([]);
  });
});
