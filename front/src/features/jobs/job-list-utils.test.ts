import { describe, expect, it } from 'vitest';
import type { JobHealthEntry } from './job-list-utils';
import { filterJobsBySearch, JOB_HEALTH_ORDER, sortJobsByAttention } from './job-list-utils';

const job = (kind: string, health: JobHealthEntry['health']): JobHealthEntry => ({ kind, health });

describe('JOB_HEALTH_ORDER', () => {
  it('ranks failing first and healthy last', () => {
    expect(JOB_HEALTH_ORDER).toEqual(['failing', 'running', 'queued', 'never_ran', 'healthy']);
  });
});

describe('sortJobsByAttention', () => {
  it('puts a failing kind before a running one, a running one before a queued one, a queued one before an idle one, and an idle one before a healthy one', () => {
    const healthy = job('zzz-recompute', 'healthy');
    const neverRan = job('never-kind', 'never_ran');
    const queued = job('queued-kind', 'queued');
    const running = job('running-kind', 'running');
    const failing = job('aaa-sync', 'failing');

    expect(sortJobsByAttention([healthy, neverRan, queued, running, failing])).toEqual([failing, running, queued, neverRan, healthy]);
  });

  it('breaks a tie between two kinds of the same health alphabetically', () => {
    const zSync = job('z-sync', 'failing');
    const aSync = job('a-sync', 'failing');

    expect(sortJobsByAttention([zSync, aSync])).toEqual([aSync, zSync]);
  });

  it('does not mutate the array it was given', () => {
    const entries = [job('z-sync', 'healthy'), job('a-sync', 'failing')];
    const untouched = [...entries];

    sortJobsByAttention(entries);

    expect(entries).toEqual(untouched);
  });
});

describe('filterJobsBySearch', () => {
  const all = [job('cve-epss-sync', 'healthy'), job('cve-cvss-sync', 'healthy'), job('tef-recompute', 'failing')];

  it('returns everything when the search is blank', () => {
    expect(filterJobsBySearch(all, '')).toEqual(all);
  });

  it('returns everything when the search is only whitespace', () => {
    expect(filterJobsBySearch(all, '   ')).toEqual(all);
  });

  it('matches the kind case-insensitively', () => {
    expect(filterJobsBySearch(all, 'CVE')).toEqual([all[0], all[1]]);
  });

  it('trims padding around the search', () => {
    expect(filterJobsBySearch(all, '  tef  ')).toEqual([all[2]]);
  });

  it('returns nothing when the search matches no kind', () => {
    expect(filterJobsBySearch(all, 'no-such-kind')).toEqual([]);
  });
});

describe('filterJobsBySearch accents', () => {
  const all = [job('école-straße', 'healthy'), job('ecole-plain', 'healthy')];

  it('should find an accented kind from its plain spelling, and the reverse', () => {
    expect(filterJobsBySearch(all, 'strasse')).toEqual([all[0]]);
    expect(filterJobsBySearch(all, 'ecole')).toEqual(all);
    expect(filterJobsBySearch(all, 'éco')).toEqual(all);
  });
});
