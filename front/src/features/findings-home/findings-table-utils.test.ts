import { describe, expect, it } from 'vitest';
import type { FindingTableSource } from './findings-table-utils';
import { toFindingSort, toFindingTableRow } from './findings-table-utils';

const source = (overrides: Partial<FindingTableSource>): FindingTableSource => ({
  evidenceId: 'e1',
  cveId: null,
  cveTitle: null,
  mitreTechniqueExternalId: null,
  mitreTechniqueName: null,
  expectationType: null,
  currentState: 'applicable',
  stateOrigin: null,
  dismissalType: null,
  score: null,
  band: null,
  pendingVector: false,
  nvdRecordMissing: false,
  assetName: null,
  assetDerivedName: null,
  assetCategoryId: null,
  sources: [],
  lastEvaluatedAt: null,
  firstSeenAt: null,
  ...overrides,
});

describe('toFindingTableRow', () => {
  it('should name a CVE finding by its id and detail it by its title', () => {
    const row = toFindingTableRow(source({ cveId: 'CVE-2024-3400', cveTitle: 'PAN-OS injection', mitreTechniqueName: 'ignored' }));
    expect(row).toMatchObject({ name: 'CVE-2024-3400', detail: 'PAN-OS injection', kind: 'vulnerability' });
  });

  it('should name a technique finding by its external id and read its kind off the expectation', () => {
    const row = toFindingTableRow(source({ mitreTechniqueExternalId: 'T1003', mitreTechniqueName: 'OS Credential Dumping', expectationType: 'prevention' }));
    expect(row).toMatchObject({ name: 'T1003', detail: 'OS Credential Dumping', kind: 'prevention_response' });
  });

  it('should count the age in whole days since first seen', () => {
    const row = toFindingTableRow(
      source({ firstSeenAt: new Date('2026-09-20T12:00:00Z') }),
      new Date('2026-09-26T12:00:00Z'),
    );
    expect(row.ageDays).toBe(6);
  });
});

describe('toFindingSort', () => {
  it('should ask for the latest first sighting first when the youngest finding comes first', () => {
    expect(toFindingSort({ id: 'ageDays', desc: false })).toEqual({ sortBy: 'firstSeenAt', sortDesc: true });
    expect(toFindingSort({ id: 'ageDays', desc: true })).toEqual({ sortBy: 'firstSeenAt', sortDesc: false });
  });

  it('should keep the direction of a column sorted on its own value', () => {
    expect(toFindingSort({ id: 'assetName', desc: false })).toEqual({ sortBy: 'assetName', sortDesc: false });
  });

  it('should fall back to the highest score first with no sort or an unsortable column', () => {
    expect(toFindingSort(undefined)).toEqual({ sortBy: 'score', sortDesc: true });
    expect(toFindingSort({ id: 'sources', desc: false })).toEqual({ sortBy: 'score', sortDesc: true });
  });
});
