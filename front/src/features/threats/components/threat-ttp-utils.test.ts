import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ThreatTechniqueRow } from './threat-ttp-utils';
import { filterThreatTechniques, revokedCitationNote, tacticsOfTechniques } from './threat-ttp-utils';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

describe('revokedCitationNote', () => {
  it('should say nothing of a technique cited as it is', () => {
    expect(revokedCitationNote('T1059.001', ['T1059.001'])).toBeNull();
  });

  it('should name every revoked id a technique succeeds', () => {
    expect(revokedCitationNote('T1685', ['T1562.001'])).toBe('Cited as T1562.001, a revoked ATT&CK ID');
    expect(revokedCitationNote('T1685', ['T1562.001', 'T1562.006'])).toBe('Cited as T1562.001 and T1562.006, revoked ATT&CK IDs');
  });

  it('should say the actor also cites the technique beside the revoked ids it succeeds', () => {
    expect(revokedCitationNote('T1685', ['T1562.001', 'T1685'])).toBe('Also cited as T1562.001, a revoked ATT&CK ID');
  });
});

const EXECUTION = { id: 'tactic-execution', externalId: 'TA0002', name: 'Execution' };
const COLLECTION = { id: 'tactic-collection', externalId: 'TA0009', name: 'Collection' };

const row = (externalId: string, name: string, tactics: ThreatTechniqueRow['tactics'], citedExternalIds = [externalId]): ThreatTechniqueRow => ({
  id: externalId.toLowerCase(),
  externalId,
  name,
  citedExternalIds,
  tactics,
  openctiStixRelationId: null,
});

const ROWS = [
  row('T1059.001', 'PowerShell', [EXECUTION]),
  row('T1114.002', 'Remote Email Collection', [COLLECTION]),
  row('T1685', 'Disable or Modify Tools', [EXECUTION, COLLECTION], ['T1562.001']),
];

describe('tacticsOfTechniques', () => {
  it('should name each tactic once, by name', () => {
    expect(tacticsOfTechniques(ROWS).map((tactic) => tactic.name)).toEqual(['Collection', 'Execution']);
  });
});

describe('filterThreatTechniques', () => {
  const externalIds = (rows: Array<ThreatTechniqueRow>) => rows.map((technique) => technique.externalId);

  it('should keep every technique with no search and no tactic', () => {
    expect(filterThreatTechniques(ROWS, { search: '', tacticId: null })).toHaveLength(3);
  });

  it('should match the ID, the name and a revoked ID the technique was cited as, ignoring case and accents', () => {
    expect(externalIds(filterThreatTechniques(ROWS, { search: 't1059', tacticId: null }))).toEqual(['T1059.001']);
    expect(externalIds(filterThreatTechniques(ROWS, { search: 'émail', tacticId: null }))).toEqual(['T1114.002']);
    expect(externalIds(filterThreatTechniques(ROWS, { search: 'T1562', tacticId: null }))).toEqual(['T1685']);
  });

  it('should keep the techniques under the tactic, a technique under several tactics included', () => {
    expect(externalIds(filterThreatTechniques(ROWS, { search: '', tacticId: COLLECTION.id }))).toEqual(['T1114.002', 'T1685']);
    expect(externalIds(filterThreatTechniques(ROWS, { search: 'tools', tacticId: EXECUTION.id }))).toEqual(['T1685']);
  });
});
