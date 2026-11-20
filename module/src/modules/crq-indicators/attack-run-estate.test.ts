import { describe, expect, it } from 'vitest';
import type { EstateCollapseInput, EstateCollapseMember, EstateCountRow, EstateRouteRow } from './attack-run-estate';
import { prepareCollapse } from './attack-run-estate';

/**
 * The collapse is where a million assets become a few hundred groups, so its failure mode is not a
 * wrong number: it is a group count that grows with the vulnerability population until a run stops
 * being affordable, with every figure still looking reasonable.
 */

const count = (
  categoryId: EstateCountRow['categoryId'],
  criticality: EstateCountRow['criticality'],
  assets: number,
): EstateCountRow => ({ categoryId, exposure: 'internal', criticality, count: assets });

const rowOf = (cveExternalId: string): string => `row-${cveExternalId}`;

const collapse = (input: EstateCollapseInput) => prepareCollapse(input).groups;

const forgoing = (input: EstateCollapseInput, cveExternalId: string) =>
  prepareCollapse(input).without(rowOf(cveExternalId));

const route = (
  supportingAssetId: string,
  cveExternalId: string,
  techniqueExternalId: string,
  over: Partial<EstateRouteRow> = {},
): EstateRouteRow => ({
  supportingAssetId,
  categoryId: 'host',
  exposure: 'internal',
  criticality: 'medium',
  matchedByScenarioGroup: false,
  cveExternalId,
  cveRowId: rowOf(cveExternalId),
  techniqueExternalId,
  ...over,
});

const member = (share: number, cves: ReadonlyArray<string>, techniques: ReadonlyArray<string>): EstateCollapseMember => ({
  share,
  cveExternalIds: new Set(cves),
  techniqueExternalIds: new Set(techniques),
});

const flooredOnly = (groups: ReturnType<typeof collapse>) => groups.filter((group) => (group.cveFloors ?? []).length > 0);

describe('the estate collapse', () => {
  it('keys a group on the tuple the law reads and on nothing else', () => {
    const groups = collapse({
      counts: [count('host', 'high', 4), count('host', 'low', 120), count('network_device', 'medium', 9)],
      scenarioGroupCounts: [count('host', 'high', 4)],
      routes: [],
      members: [],
    });
    expect(groups.map((group) => [group.family, group.criticality, group.matchedByScenarioGroup, group.assets])).toEqual([
      ['host', 'high', true, 4],
      ['host', 'low', false, 120],
      ['network_device', 'medium', false, 9],
    ]);
    expect(groups.every((group) => group.cveFloors?.length === 0)).toBe(true);
  });

  /*
   * The mask is a derived bitmask over the actor's repertoire and never the raw open-CVE set. Two
   * assets whose patch states differ on CVEs that floor the same route are one group, which is the
   * whole reason the collapse survives a real estate: keyed on the CVEs they would be two.
   */
  it('collapses assets that floor the same routes through different CVEs', () => {
    const groups = collapse({
      counts: [count('host', 'medium', 10)],
      scenarioGroupCounts: [],
      routes: [
        route('asset-1', 'CVE-2024-0001', 'T1190'),
        route('asset-2', 'CVE-2024-0002', 'T1190'),
      ],
      members: [member(1, ['CVE-2024-0001', 'CVE-2024-0002'], ['T1190'])],
    });
    const floored = flooredOnly(groups);
    expect(floored).toHaveLength(1);
    expect(floored[0].assets).toBe(2);
    expect(groups.find((group) => (group.cveFloors ?? []).length === 0)?.assets).toBe(8);
  });

  it('keeps the reference groups what the masks alone make them', () => {
    const groups = collapse({
      counts: [count('host', 'medium', 10)],
      scenarioGroupCounts: [],
      routes: [route('asset-1', 'CVE-2024-0001', 'T1190')],
      members: [member(1, ['CVE-2024-0001'], ['T1190'])],
    });
    expect(flooredOnly(groups).map((group) => group.id)).toEqual(['host|internal|medium|estate|T1190=1']);
  });

  describe('the groups of one dismissed CVE', () => {
    /** What a rerun builds once the CVE's findings are dismissed: the same collapse, without its routes. */
    const rerun = (input: EstateCollapseInput, cveExternalId: string) =>
      collapse({ ...input, routes: input.routes.filter((entry) => entry.cveExternalId !== cveExternalId) });

    it('merges the assets that lose every floor into the plain group of their key', () => {
      const input = {
        counts: [count('host', 'medium', 4)],
        scenarioGroupCounts: [],
        routes: [
          route('asset-3', 'CVE-2024-0001', 'T1190'),
          route('asset-4', 'CVE-2024-0001', 'T1190'),
        ],
        members: [member(1, ['CVE-2024-0001'], ['T1190'])],
      };
      expect(collapse(input).map((group) => group.assets).sort()).toEqual([2, 2]);
      const groups = forgoing(input, 'CVE-2024-0001')!;
      expect(groups.map((group) => [group.assets, group.cveFloors])).toEqual([[4, []]]);
      expect(groups).toEqual(rerun(input, 'CVE-2024-0001'));
    });

    it('merges an asset that keeps a smaller mask into the existing group of that mask', () => {
      const input = {
        counts: [count('host', 'medium', 10)],
        scenarioGroupCounts: [],
        routes: [
          route('asset-1', 'CVE-2024-0001', 'T1190'),
          route('asset-2', 'CVE-2024-0001', 'T1190'),
          route('asset-2', 'CVE-2024-0002', 'T1133'),
          route('asset-3', 'CVE-2024-0002', 'T1133'),
        ],
        members: [member(1, ['CVE-2024-0001', 'CVE-2024-0002'], ['T1190', 'T1133'])],
      };
      const groups = forgoing(input, 'CVE-2024-0001')!;
      expect(flooredOnly(groups).map((group) => [group.assets, group.cveFloors!.map((floor) => floor.techniqueExternalId)]))
        .toEqual([[2, ['T1133']]]);
      expect(groups).toEqual(rerun(input, 'CVE-2024-0001'));
    });

    it('moves only the assets the CVE changes, and leaves the others in their reference group', () => {
      const input = {
        counts: [count('host', 'medium', 10)],
        scenarioGroupCounts: [],
        routes: [
          route('asset-1', 'CVE-2024-0001', 'T1190'),
          route('asset-2', 'CVE-2024-0002', 'T1190'),
          route('asset-3', 'CVE-2024-0002', 'T1190'),
        ],
        members: [member(1, ['CVE-2024-0001', 'CVE-2024-0002'], ['T1190'])],
      };
      const reference = collapse(input);
      const groups = forgoing(input, 'CVE-2024-0001')!;
      expect(flooredOnly(groups)).toEqual(flooredOnly(reference).map((group) => ({ ...group, assets: 2 })));
      expect(groups.find((group) => (group.cveFloors ?? []).length === 0)?.assets).toBe(8);
      expect(groups).toEqual(rerun(input, 'CVE-2024-0001'));
    });

    it('answers null for a CVE whose removal leaves every mask whole', () => {
      const input = {
        counts: [count('host', 'medium', 10)],
        scenarioGroupCounts: [],
        routes: [
          route('asset-1', 'CVE-2024-0001', 'T1190'),
          route('asset-1', 'CVE-2024-0002', 'T1190'),
        ],
        members: [member(1, ['CVE-2024-0001', 'CVE-2024-0002'], ['T1190'])],
      };
      expect(forgoing(input, 'CVE-2024-0001')).toBeNull();
      expect(forgoing(input, 'CVE-2024-0002')).toBeNull();
    });

    it('answers null for a CVE no asset floors a route through', () => {
      expect(forgoing({
        counts: [count('host', 'medium', 10)],
        scenarioGroupCounts: [],
        routes: [route('asset-1', 'CVE-2024-0001', 'T1190')],
        members: [member(1, ['CVE-2024-0001'], ['T1190'])],
      }, 'CVE-2024-0009')).toBeNull();
    });

    it('drops only the members the dismissed CVE alone floored', () => {
      const input = {
        counts: [count('host', 'medium', 10)],
        scenarioGroupCounts: [],
        routes: [
          route('asset-1', 'CVE-2024-0001', 'T1190'),
          route('asset-1', 'CVE-2024-0002', 'T1190'),
        ],
        members: [
          member(0.6, ['CVE-2024-0001'], ['T1190']),
          member(0.4, ['CVE-2024-0002'], ['T1190']),
        ],
      };
      const [first] = flooredOnly(forgoing(input, 'CVE-2024-0001')!);
      const [second] = flooredOnly(forgoing(input, 'CVE-2024-0002')!);
      expect(first.cveFloors).toHaveLength(1);
      expect(first.cveFloors![0].share).toBeCloseTo(0.4, 12);
      expect(second.cveFloors![0].share).toBeCloseTo(0.6, 12);
    });

    it('keeps the reference groups of every asset the CVE does not touch, plain groups of other keys included', () => {
      const input = {
        counts: [count('host', 'medium', 50), count('network_device', 'low', 7)],
        scenarioGroupCounts: [count('host', 'medium', 20)],
        routes: [
          route('asset-1', 'CVE-2024-0001', 'T1190'),
          route('asset-2', 'CVE-2024-0002', 'T1133', { matchedByScenarioGroup: true }),
        ],
        members: [member(1, ['CVE-2024-0001', 'CVE-2024-0002'], ['T1190', 'T1133'])],
      };
      const reference = collapse(input);
      const groups = forgoing(input, 'CVE-2024-0001')!;
      expect(groups.filter((group) => group.family === 'network_device')).toEqual(reference.filter((group) => group.family === 'network_device'));
      expect(groups.find((group) => group.matchedByScenarioGroup && (group.cveFloors ?? []).length > 0))
        .toEqual(reference.find((group) => group.matchedByScenarioGroup && (group.cveFloors ?? []).length > 0));
      expect(groups).toEqual(rerun(input, 'CVE-2024-0001'));
    });

    it('keeps the asset count whole however the masks regroup it', () => {
      const groups = forgoing({
        counts: [count('host', 'medium', 50)],
        scenarioGroupCounts: [count('host', 'medium', 20)],
        routes: [
          route('asset-1', 'CVE-2024-0001', 'T1190'),
          route('asset-2', 'CVE-2024-0001', 'T1190', { matchedByScenarioGroup: true }),
          route('asset-2', 'CVE-2024-0001', 'T1133', { matchedByScenarioGroup: true }),
        ],
        members: [member(1, ['CVE-2024-0001'], ['T1190', 'T1133'])],
      }, 'CVE-2024-0001')!;
      expect(flooredOnly(groups)).toEqual([]);
      expect(groups.reduce((sum, group) => sum + group.assets, 0)).toBe(50);
      expect(groups.filter((group) => group.matchedByScenarioGroup).reduce((sum, group) => sum + group.assets, 0)).toBe(20);
    });
  });

  it('bounds the mask by the member repertoire and by the member known-exploited set', () => {
    const groups = collapse({
      counts: [count('host', 'medium', 10)],
      scenarioGroupCounts: [],
      routes: [
        route('asset-1', 'CVE-2024-0001', 'T1190'),
        route('asset-1', 'CVE-2024-0009', 'T1133'),
        route('asset-2', 'CVE-2024-0009', 'T1133'),
        route('asset-3', 'CVE-2024-0001', 'T1566'),
      ],
      members: [member(1, ['CVE-2024-0001'], ['T1190'])],
    });
    const floored = flooredOnly(groups);
    expect(floored).toHaveLength(1);
    expect(floored[0].cveFloors).toEqual([{ techniqueExternalId: 'T1190', share: 1 }]);
    expect(floored[0].assets).toBe(1);
  });

  /*
   * A class floors a route only for the holders that exploit a CVE the asset carries. Read as a bit,
   * one member's CVE would floor the route for every member holding the technique.
   */
  it('floors a class route by the share of its holders that exploit the CVE', () => {
    const groups = collapse({
      counts: [count('host', 'medium', 10)],
      scenarioGroupCounts: [],
      routes: [route('asset-1', 'CVE-2024-0001', 'T1190')],
      members: [
        member(0.1, ['CVE-2024-0001'], ['T1190']),
        member(0.3, [], ['T1190']),
        member(0.6, ['CVE-2024-0001'], ['T1566']),
      ],
    });
    const floored = flooredOnly(groups);
    expect(floored).toHaveLength(1);
    expect(floored[0].cveFloors?.[0].techniqueExternalId).toBe('T1190');
    expect(floored[0].cveFloors?.[0].share).toBeCloseTo(0.25, 12);
  });
});
