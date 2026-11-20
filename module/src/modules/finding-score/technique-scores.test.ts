import { describe, expect, it } from 'vitest';
import type { EntryAsset, UnknownExposureCountsAs } from '../attack-surfaces/entry-applicability';
import type { HeldOpening, HeldOpenings } from './technique-scores';
import { parseCvssContributions } from '../cve/cvss-vector';
import { findingOpenings, holdWorstOpening, openingFigure, susceptibilityCell, techniqueOpening } from './technique-scores';

describe('the opening of a technique', () => {
  it('reads vector access times threat times the impact the finding score reads', () => {
    expect(openingFigure(techniqueOpening(1, 0.984, 1))).toBe(98);
  });

  it('narrows a flaw that only reaches part of the asset the way the finding score does', () => {
    const { impact } = parseCvssContributions('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H')!;
    expect(openingFigure(techniqueOpening(1, 0.9, impact))).toBe(55);
  });
});

describe('what a finding opens', () => {
  const techniques = [
    { techniqueId: 'public-app', externalId: 'T1190' },
    { techniqueId: 'phishing-attachment', externalId: 'T1566.001' },
    { techniqueId: 'drive-by', externalId: 'T1189' },
    { techniqueId: 'remote-services', externalId: 'T1210' },
  ];
  const input = (asset: Partial<EntryAsset>, unknownExposureCountsAs: UnknownExposureCountsAs = 'internal') => ({
    asset: { categoryId: 'host' as const, subcategoryId: null, exposure: 'internet_facing' as const, identityEnabled: true, ...asset },
    unknownExposureCountsAs,
    techniques,
    access: 1,
    threat: 0.9,
    impact: 0.5,
  });
  const opened = (asset: Partial<EntryAsset>, unknownExposureCountsAs?: UnknownExposureCountsAs) =>
    findingOpenings(input(asset, unknownExposureCountsAs)).map((opening) => opening.mitreTechniqueId);

  it('gives each technique the finding claims the same opening', () => {
    const openings = findingOpenings(input({}));
    expect(openings.map(({ mitreTechniqueId, opening }) => [mitreTechniqueId, openingFigure(opening)])).toEqual([
      ['public-app', 45],
      ['phishing-attachment', 45],
      ['drive-by', 45],
      ['remote-services', 45],
    ]);
  });

  it('closes the exposed-service techniques on an internal asset, the other techniques staying', () => {
    expect(opened({ exposure: 'internal' })).toEqual(['phishing-attachment', 'drive-by', 'remote-services']);
  });

  it('opens the user-reaching techniques on an internal workstation and closes them on an internal server', () => {
    expect(opened({ exposure: 'internal', subcategoryId: 'workstation' })).toEqual(['phishing-attachment', 'drive-by', 'remote-services']);
    expect(opened({ exposure: 'internal', subcategoryId: 'server' })).toEqual(['remote-services']);
  });

  it('closes the user-reaching techniques on a generic asset, whatever its exposure', () => {
    expect(opened({ categoryId: 'generic_asset', exposure: 'internet_facing' })).toEqual(['public-app', 'remote-services']);
  });

  it('reads an unknown exposure through the tenant setting', () => {
    expect(opened({ exposure: 'unknown' }, 'internal')).not.toContain('public-app');
    expect(opened({ exposure: 'unknown' }, 'internet_facing')).toContain('public-app');
  });

  it('gates valid accounts on an enabled identity, and leaves a technique outside Initial Access alone', () => {
    const accounts = { ...input({ categoryId: 'identity', subcategoryId: 'user_account' }), techniques: [
      { techniqueId: 'valid-accounts', externalId: 'T1078.001' },
      { techniqueId: 'remote-services', externalId: 'T1210' },
    ] };
    expect(findingOpenings(accounts).map((opening) => opening.mitreTechniqueId)).toEqual(['valid-accounts', 'remote-services']);
    expect(findingOpenings({ ...accounts, asset: { ...accounts.asset, identityEnabled: false } }).map((opening) => opening.mitreTechniqueId))
      .toEqual(['remote-services']);
    expect(findingOpenings({ ...accounts, asset: { ...accounts.asset, categoryId: 'host', subcategoryId: 'server' } }).map((opening) => opening.mitreTechniqueId))
      .toEqual(['remote-services']);
  });
});

describe('the finding holding a cell', () => {
  const held = (evidenceId: string, opening: number): HeldOpening => ({
    supportingAssetId: 'asset', mitreTechniqueId: 'technique', opening, evidenceId,
  });

  it('keeps the finding opening the technique the most', () => {
    const cells: HeldOpenings = new Map();
    holdWorstOpening(cells, held('b', 0.4));
    holdWorstOpening(cells, held('c', 0.7));
    holdWorstOpening(cells, held('a', 0.2));
    expect([...cells.values()].map((cell) => cell.evidenceId)).toEqual(['c']);
  });

  it('breaks a tie on the lower finding id, whatever order the findings come in', () => {
    const forward: HeldOpenings = new Map();
    holdWorstOpening(forward, held('a', 0.5));
    holdWorstOpening(forward, held('b', 0.5));
    const backward: HeldOpenings = new Map();
    holdWorstOpening(backward, held('b', 0.5));
    holdWorstOpening(backward, held('a', 0.5));
    expect([forward, backward].map((cells) => [...cells.values()][0].evidenceId)).toEqual(['a', 'a']);
  });
});

describe('the susceptibility cell of a person', () => {
  const account = (asset: Partial<EntryAsset> = {}): EntryAsset => ({
    categoryId: 'identity',
    subcategoryId: 'user_account',
    exposure: 'unknown',
    identityEnabled: true,
    ...asset,
  });
  const now = new Date('2026-10-01T12:00:00Z');
  const undeclared = { unknownExposureCountsAs: 'internal' as const, phishingFailureRate: null, phishingFailureMeasuredOn: null, measuredValidityDays: null };
  const declared = { ...undeclared, phishingFailureRate: 0.126, phishingFailureMeasuredOn: '2026-09-01' };

  it('reads the default susceptibility of an enabled user account that no simulation measured', () => {
    expect(susceptibilityCell(account(), undeclared, now)).toEqual({ score: 7, rate: 0.07, declared: false, expired: false, measuredOn: null });
  });

  it('reads the declared rate, and the day it was measured, with the score rounded from it', () => {
    expect(susceptibilityCell(account(), declared, now)).toEqual({ score: 13, rate: 0.126, declared: true, expired: false, measuredOn: '2026-09-01' });
  });

  it('reads a declared rate of zero as a declaration, not as an absence', () => {
    expect(susceptibilityCell(account(), { ...declared, phishingFailureRate: 0 }, now)).toEqual({ score: 0, rate: 0, declared: true, expired: false, measuredOn: '2026-09-01' });
  });

  it('reads the default once the declared simulation is older than the validity window, keeping its day', () => {
    expect(susceptibilityCell(account(), { ...declared, measuredValidityDays: 29 }, now)).toEqual({ score: 7, rate: 0.07, declared: false, expired: true, measuredOn: '2026-09-01' });
    expect(susceptibilityCell(account(), { ...declared, measuredValidityDays: 30 }, now)?.declared).toBe(true);
  });

  it('gives a disabled account no cell, as the door counts no person there', () => {
    expect(susceptibilityCell(account({ identityEnabled: false }), declared, now)).toBeNull();
  });

  it('gives no cell to an identity that is not a user account', () => {
    expect(susceptibilityCell(account({ subcategoryId: 'service_account' }), declared, now)).toBeNull();
    expect(susceptibilityCell(account({ subcategoryId: null }), declared, now)).toBeNull();
  });

  it('gives a workstation no cell: its T1566 cell stays the one a finding opens', () => {
    expect(susceptibilityCell({ categoryId: 'host', subcategoryId: 'workstation', exposure: 'internal', identityEnabled: true }, declared, now)).toBeNull();
    expect(susceptibilityCell({ categoryId: 'mobile_device', subcategoryId: null, exposure: 'internal', identityEnabled: true }, declared, now)).toBeNull();
  });
});
