import { describe, expect, it } from 'vitest';
import type { UniqueFindingTableSource } from './unique-findings-table-utils';
import { toUniqueFindingTableRow } from './unique-findings-table-utils';

const NOW = new Date('2026-10-07T12:00:00Z');

const group = (overrides: Partial<UniqueFindingTableSource>): UniqueFindingTableSource => ({
  key: 'k1',
  cveId: null,
  cveTitle: null,
  knownExploited: null,
  epss: null,
  mitreTechniqueExternalId: null,
  mitreTechniqueName: null,
  expectationType: null,
  score: null,
  band: null,
  worstScore: null,
  worstBand: null,
  pendingVector: false,
  nvdRecordMissing: false,
  affectedAssetCount: 1,
  sources: [],
  firstSeenAt: NOW,
  ...overrides,
});

describe('toUniqueFindingTableRow', () => {
  it('should name a CVE group by its id, detail it by its title and open the list on that CVE', () => {
    const row = toUniqueFindingTableRow(group({ cveId: 'CVE-2023-4966', cveTitle: 'Citrix Bleed', mitreTechniqueName: 'ignored' }), NOW);

    expect(row).toMatchObject({ name: 'CVE-2023-4966', detail: 'Citrix Bleed', isTechnique: false, vulnerabilityToken: 'CVE-2023-4966' });
  });

  it('should name a technique group by its external id and open the list on it and its expectation', () => {
    const row = toUniqueFindingTableRow(group({ mitreTechniqueExternalId: 'T1059', mitreTechniqueName: 'Command and Scripting Interpreter', expectationType: 'detection' }), NOW);

    expect(row).toMatchObject({ name: 'T1059', detail: 'Command and Scripting Interpreter', isTechnique: true, vulnerabilityToken: 'T1059:detection' });
  });

  it('should print the EPSS probability as a whole percentage', () => {
    expect(toUniqueFindingTableRow(group({ cveId: 'CVE-2024-3400', epss: 0.9437 }), NOW).epssPercent).toBe(94);
    expect(toUniqueFindingTableRow(group({ cveId: 'CVE-2024-3400', epss: 0.145 }), NOW).epssPercent).toBe(15);
    expect(toUniqueFindingTableRow(group({ cveId: 'CVE-2024-3400' }), NOW).epssPercent).toBeNull();
  });

  it('should count the age in whole days since the oldest finding was first seen', () => {
    expect(toUniqueFindingTableRow(group({ firstSeenAt: '2026-09-07T12:00:00Z' }), NOW).ageDays).toBe(30);
  });
});
