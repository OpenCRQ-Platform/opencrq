import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { countConcerningTargets, matchedTechniques, pickBestOutcomeMatch, threatActivityStatus, threatActivityStatusLabel } from './threat-hero-utils';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

const DAY_MS = 86_400_000;
const NOW = new Date('2026-11-06T12:00:00Z');
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * DAY_MS).toISOString();

describe('matchedTechniques', () => {
  it('keeps only the techniques the MITRE catalogue resolves', () => {
    const techniques = [
      { name: 'Phishing', mitreTechniqueId: 'a' },
      { name: 'Unknown', mitreTechniqueId: null },
      { name: 'PowerShell', mitreTechniqueId: 'b' },
    ];
    expect(matchedTechniques(techniques).map((technique) => technique.name)).toEqual(['Phishing', 'PowerShell']);
  });

  it('is empty when nothing resolves', () => {
    expect(matchedTechniques([{ mitreTechniqueId: null }])).toEqual([]);
  });
});

describe('countConcerningTargets', () => {
  it('counts the countries and the sectors that match one of the tenant organizations', () => {
    const locations = [{ matchesOrganization: true }, { matchesOrganization: false }, { matchesOrganization: true }];
    const sectors = [{ matchesOrganization: false }, { matchesOrganization: true }];
    expect(countConcerningTargets(locations, sectors)).toBe(3);
  });

  it('is zero when nothing is targeted', () => {
    expect(countConcerningTargets([], [])).toBe(0);
  });
});

describe('pickBestOutcomeMatch', () => {
  const outcome = (outcomeName: string, score: number) => ({ attackOutcomeId: outcomeName, outcomeName, score });

  it('picks the highest score whatever the order', () => {
    expect(pickBestOutcomeMatch([outcome('A', 0.2), outcome('B', 0.82), outcome('C', 0.5)])?.outcomeName).toBe('B');
  });

  it('breaks a tie by name', () => {
    expect(pickBestOutcomeMatch([outcome('Ransomware', 0.4), outcome('Data theft', 0.4)])?.outcomeName).toBe('Data theft');
  });

  it('is null when no outcome matches', () => {
    expect(pickBestOutcomeMatch([outcome('A', 0), outcome('B', 0)])).toBeNull();
    expect(pickBestOutcomeMatch([])).toBeNull();
  });
});

describe('threatActivityStatus', () => {
  it('is active inside the active window', () => {
    expect(threatActivityStatus(daysAgo(3), NOW)).toBe('active');
    expect(threatActivityStatus(daysAgo(60), NOW)).toBe('active');
  });

  it('is dormant past the active window', () => {
    expect(threatActivityStatus(daysAgo(400), NOW)).toBe('dormant');
  });

  it('is not dated without an observation', () => {
    expect(threatActivityStatus(null, NOW)).toBe('not-dated');
    expect(threatActivityStatus('not a date', NOW)).toBe('not-dated');
  });

  it('words each status', () => {
    expect((['active', 'dormant', 'not-dated'] as const).map(threatActivityStatusLabel)).toEqual(['Active', 'Dormant', 'Not dated']);
  });
});
