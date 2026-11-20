import { describe, expect, it } from 'vitest';
import { mitreTechniquesData } from '../mitre-attack/data/mitre-techniques';
import { readTopologyExploitation, TOPOLOGY_RULE_TECHNIQUE_EXTERNAL_IDS } from './topology-rule';

const vector = (metrics: string): string => `CVSS:3.1/${metrics}/S:U/C:H/I:H/A:H`;

const techniquesOf = (
  cvssVector: string | null,
  exposure: 'internet_facing' | 'internal' | 'unknown',
  cwe: Array<string> | null = null,
  cvssV2UserInteractionRequired: boolean | null = null,
) => readTopologyExploitation({ cvssVector, cvssV2UserInteractionRequired, cwe, exposure })?.techniqueExternalIds ?? null;

describe('readTopologyExploitation', () => {
  it('gives T1190 to a network flaw needing nobody on an internet-facing asset', () => {
    expect(techniquesOf(vector('AV:N/AC:L/PR:N/UI:N'), 'internet_facing')).toEqual(['T1190']);
  });

  it('gives T1210 to the same flaw on an internal asset', () => {
    expect(techniquesOf(vector('AV:N/AC:L/PR:N/UI:N'), 'internal')).toEqual(['T1210']);
  });

  it('gives both when the exposure is unknown', () => {
    expect(techniquesOf(vector('AV:N/AC:L/PR:N/UI:N'), 'unknown')).toEqual(['T1190', 'T1210']);
  });

  it('puts T1078 first when the flaw needs privileges', () => {
    expect(techniquesOf(vector('AV:N/AC:L/PR:L/UI:N'), 'internet_facing')).toEqual(['T1078', 'T1190']);
    expect(techniquesOf(vector('AV:N/AC:L/PR:H/UI:N'), 'internal')).toEqual(['T1078', 'T1210']);
    expect(techniquesOf(vector('AV:L/AC:L/PR:L/UI:N'), 'internal')).toEqual(['T1078', 'T1068']);
    expect(techniquesOf(vector('AV:P/AC:L/PR:H/UI:N'), 'unknown')).toEqual(['T1078', 'T1200', 'T1091']);
  });

  it('reaches a user through a drive-by or a phishing, then client execution, on an exposed asset', () => {
    expect(techniquesOf(vector('AV:N/AC:L/PR:N/UI:R'), 'internet_facing')).toEqual(['T1189', 'T1566', 'T1203']);
  });

  it('reaches a user through a drive-by, a phishing and an internal spearphishing on an internal asset', () => {
    expect(techniquesOf(vector('AV:N/AC:L/PR:N/UI:R'), 'internal')).toEqual(['T1189', 'T1566', 'T1534', 'T1203']);
  });

  it('gives T1210 to an adjacent flaw', () => {
    expect(techniquesOf(vector('AV:A/AC:L/PR:N/UI:N'), 'internet_facing')).toEqual(['T1210']);
  });

  it('gives T1068 to a local flaw needing nobody', () => {
    expect(techniquesOf(vector('AV:L/AC:L/PR:N/UI:N'), 'internal')).toEqual(['T1068']);
  });

  it('gives a malicious file then client execution to a local flaw needing a user', () => {
    expect(techniquesOf(vector('AV:L/AC:L/PR:N/UI:R'), 'internal')).toEqual(['T1204.002', 'T1203']);
  });

  it('gives hardware additions or removable media to a physical flaw', () => {
    expect(techniquesOf(vector('AV:P/AC:L/PR:N/UI:N'), 'unknown')).toEqual(['T1200', 'T1091']);
  });

  it('reads a CVSS 4.0 active interaction as a user having to act', () => {
    expect(techniquesOf('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:A/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N', 'internal'))
      .toEqual(['T1189', 'T1566', 'T1534', 'T1203']);
  });

  it('short-circuits every vector when the weakness is a hard-coded credential', () => {
    const rule = readTopologyExploitation({
      cvssVector: vector('AV:N/AC:L/PR:N/UI:N'),
      cvssV2UserInteractionRequired: null,
      cwe: ['CWE-79', 'CWE-798'],
      exposure: 'internal',
    });
    expect(rule?.techniqueExternalIds).toEqual(['T1078.001']);
    expect(rule?.reading).toEqual({ kind: 'weakness', cwe: 'CWE-798' });
  });

  it('answers the hard-coded credential even without a vector', () => {
    expect(techniquesOf(null, 'unknown', ['CWE-798'])).toEqual(['T1078.001']);
  });

  it('reads a CVSS 2.0 vector through the 3.1 letters its metrics map to', () => {
    expect(techniquesOf('AV:N/AC:L/Au:N/C:N/I:N/A:P', 'internet_facing')).toEqual(['T1190']);
    expect(techniquesOf('AV:N/AC:M/Au:S/C:P/I:P/A:P', 'internal')).toEqual(['T1078', 'T1210']);
    expect(techniquesOf('AV:L/AC:L/Au:N/C:C/I:C/A:C', 'internal')).toEqual(['T1068']);
  });

  it('reads a CVSS 2.0 flaw as needing a user when NVD flags it so', () => {
    expect(techniquesOf('AV:N/AC:M/Au:N/C:P/I:P/A:P', 'internet_facing', null, true)).toEqual(['T1189', 'T1566', 'T1203']);
    expect(readTopologyExploitation({
      cvssVector: 'AV:N/AC:M/Au:N/C:P/I:P/A:P',
      cvssV2UserInteractionRequired: true,
      cwe: null,
      exposure: 'internal',
    })?.reading).toMatchObject({ kind: 'vector', attackVector: 'N', userInteraction: 'R', privilegesRequired: 'N' });
  });

  it('ignores the 2.0 user interaction flag on a 3.1 vector, which states its own', () => {
    expect(techniquesOf(vector('AV:N/AC:L/PR:N/UI:N'), 'internet_facing', null, true)).toEqual(['T1190']);
  });

  it('answers nothing without a vector it reads', () => {
    expect(techniquesOf(null, 'internet_facing')).toBeNull();
    expect(techniquesOf('AV:N/AC:L/Au:N/C:P/I:P', 'internet_facing')).toBeNull();
    expect(techniquesOf('CVSS:2.0/AV:N/AC:L/Au:N/C:P/I:P/A:P', 'internet_facing')).toBeNull();
  });

  it('only names techniques the catalogue carries', () => {
    const catalogue = new Set(mitreTechniquesData.filter((technique) => technique.revoked !== true).map((technique) => technique.externalId));
    expect(TOPOLOGY_RULE_TECHNIQUE_EXTERNAL_IDS.filter((externalId) => !catalogue.has(externalId))).toEqual([]);
  });
});
