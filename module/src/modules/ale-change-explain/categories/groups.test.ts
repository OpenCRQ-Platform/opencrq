import { describe, expect, it } from 'vitest';
import type { ChangeCategoryKey, ChangeEvent } from '../types';
import { groupEvents, sortedBy } from './groups';

const bandMove = (category: ChangeCategoryKey, at: string, name: string): ChangeEvent => {
  const cve = category.startsWith('findings-');
  return {
    category,
    moment: { kind: 'recorded', at },
    direction: 'up',
    item: cve
      ? { kind: 'cve', key: name, label: name, link: { kind: 'cve', cveId: name } }
      : { kind: 'asset', key: name, label: name, link: { kind: 'asset', supportingAssetId: name } },
    sentence: { key: cve ? 'cve-band-moved' : 'posture-band-moved', parts: { from: 'medium', to: 'high' } },
    values: null,
  };
};

const moves = (category: ChangeCategoryKey, day: string, count: number): Array<ChangeEvent> =>
  Array.from({ length: count }, (_, index) => bandMove(category, `${day}T09:${String(index).padStart(2, '0')}:00.000Z`, `item-${index}`));

describe('groups of changes', () => {
  it.each([
    ['findings-critical', 'cve-group', 'band-moved'],
    ['findings-high', 'cve-group', 'band-moved'],
    ['assets-critical', 'asset-group', 'posture-moved'],
    ['assets-high', 'asset-group', 'posture-moved'],
  ] as const)('group %s per node and change kind whatever the count, down to one item', (category, groupKind, kind) => {
    const events = groupEvents([...moves(category, '2026-10-02', 1), ...moves(category, '2026-10-03', 6)], [], 'UTC');

    expect(events.map((event) => [event.item.kind, event.group?.up])).toEqual([[groupKind, 1], [groupKind, 6]]);
    expect(events[1]).toMatchObject({
      category,
      direction: 'up',
      group: { kind, up: 6, down: 0, bands: [{ from: 'medium', to: 'high', count: 6 }] },
    });
  });

  it('order the CVEs that left by the band they left, from no band up to Critical, ties by name', () => {
    const left = (name: string, band: string, assets: number) => ({
      event: { ...bandMove('findings-other', '2026-10-02T09:00:00.000Z', name), sentence: { key: 'cve-left', parts: { band } } },
      assets,
    });
    const members = [left('cve-b', 'high', 3), left('cve-a', 'critical', 1), left('cve-c', 'high', 9), left('cve-d', 'none', 2)];
    const order = (by: 'band' | 'assets', desc: boolean) => members.toSorted(sortedBy('left', { by, desc })).map(({ event }) => event.item.key);

    expect(order('band', false)).toEqual(['cve-d', 'cve-b', 'cve-c', 'cve-a']);
    expect(order('band', true)).toEqual(['cve-a', 'cve-b', 'cve-c', 'cve-d']);
    expect(order('assets', true)).toEqual(['cve-c', 'cve-b', 'cve-d', 'cve-a']);
  });

  it('order assets moved into one posture by the posture they left, the steepest fall first descending', () => {
    const moved = (name: string, from: string) => ({
      event: { ...bandMove('assets-critical', '2026-10-02T09:00:00.000Z', name), sentence: { key: 'posture-band-moved', parts: { from, to: 'critical' } } },
      assets: null,
    });
    const members = [moved('ws-a', 'high'), moved('ws-b', 'low'), moved('ws-c', 'medium'), moved('ws-d', 'high')];
    const order = (desc: boolean) => members.toSorted(sortedBy('posture-moved', { by: 'band', desc })).map(({ event }) => event.item.key);

    expect(order(true)).toEqual(['ws-b', 'ws-c', 'ws-a', 'ws-d']);
    expect(order(false)).toEqual(['ws-a', 'ws-d', 'ws-c', 'ws-b']);
  });

  it('group the other assets of a node whatever their count, apart from the Critical ones of that node', () => {
    const events = groupEvents([...moves('assets-other', '2026-10-02', 1), ...moves('assets-critical', '2026-10-02', 6)], [], 'UTC');

    expect(events.map((event) => [event.category, event.group?.up])).toEqual([['assets-other', 1], ['assets-critical', 6]]);
  });
});
