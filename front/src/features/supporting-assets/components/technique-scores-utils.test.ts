import { describe, expect, it } from 'vitest';
import type { TechniqueScoreCell, TechniqueScoreFinding } from './technique-scores-utils';
import { holdingFindingOf, openingEvidence, ratePercent } from './technique-scores-utils';

describe('openingEvidence', () => {
  it('reads vector access from AV, PR and UI', () => {
    expect(openingEvidence('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H')).toEqual({
      accessMetrics: [{ metric: 'AV', value: 'N' }, { metric: 'PR', value: 'N' }, { metric: 'UI', value: 'N' }],
      highComplexity: false,
      requirementsPresent: false,
    });
  });

  it('says a high attack complexity damps the threat', () => {
    expect(openingEvidence('CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H')).toMatchObject({ highComplexity: true, requirementsPresent: false });
  });

  it('tells 4.0 attack requirements present apart from a high complexity', () => {
    expect(openingEvidence('CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N')).toMatchObject({ highComplexity: false, requirementsPresent: true });
  });
});

describe('holdingFindingOf', () => {
  const finding: TechniqueScoreFinding = {
    evidenceId: 'reader',
    cveId: 'CVE-2021-41773',
    cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N',
    epss: 0.94,
    knownExploited: true,
    access: 1,
    threat: 0.96,
    impact: 0.61,
  };
  const cell: TechniqueScoreCell = {
    mitreTechniqueId: 't1190',
    externalId: 'T1190',
    name: 'Exploit Public-Facing Application',
    score: 59,
    evidenceId: 'reader',
    source: 'finding',
    lane: 'topology',
  };

  it('finds the finding a cell is held by', () => {
    expect(holdingFindingOf(cell, new Map([['reader', finding]]))).toBe(finding);
  });

  it('finds nothing when the read could not describe the finding', () => {
    expect(holdingFindingOf(cell, new Map())).toBeUndefined();
  });

  it('finds nothing for a cell no finding holds', () => {
    expect(holdingFindingOf(null, new Map([['reader', finding]]))).toBeUndefined();
    expect(holdingFindingOf({ ...cell, evidenceId: null, source: 'susceptibility', lane: null }, new Map([['reader', finding]]))).toBeUndefined();
  });
});

describe('ratePercent', () => {
  it('keeps one decimal of a declared rate', () => {
    expect(ratePercent(0.126)).toBe(12.6);
    expect(ratePercent(0.1234)).toBe(12.3);
  });

  it('prints a whole rate without a decimal', () => {
    expect(ratePercent(0.07)).toBe(7);
    expect(ratePercent(0)).toBe(0);
    expect(ratePercent(1)).toBe(100);
  });
});
