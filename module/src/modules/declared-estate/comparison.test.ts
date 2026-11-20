import { describe, expect, it } from 'vitest';
import type { MeasuredAssetCountRow } from './comparison';
import { compareDeclaredEstate, comparisonStateOf, measuredCountsByKind } from './comparison';

const row = (
  categoryId: MeasuredAssetCountRow['categoryId'],
  subcategoryId: MeasuredAssetCountRow['subcategoryId'],
  assetCount: number,
  identityEnabled = true,
): MeasuredAssetCountRow => ({ categoryId, subcategoryId, identityEnabled, assetCount });

describe('measuredCountsByKind', () => {
  it('should count a host with no subcategory as a workstation', () => {
    expect(measuredCountsByKind([row('host', 'laptop', 3), row('host', null, 2)]).get('workstations')).toBe(5);
  });

  it('should leave disabled accounts out of people', () => {
    expect(measuredCountsByKind([row('identity', 'user_account', 7), row('identity', 'user_account', 4, false)]).get('people')).toBe(7);
  });

  it('should count an IAM principal as a cloud resource', () => {
    expect(measuredCountsByKind([row('cloud_resource', 'iam_principal', 6)]).get('cloud_resources')).toBe(6);
  });

  it('should count groups and generic assets in no kind', () => {
    const counts = measuredCountsByKind([row('identity', 'group', 9), row('generic_asset', null, 4)]);

    expect([...counts.values()]).toEqual([]);
  });
});

describe('comparisonStateOf', () => {
  it.each([
    [{ low: 1001, high: 5000 }, 500, 'below'],
    [{ low: 1001, high: 5000 }, 1001, 'within'],
    [{ low: 1001, high: 5000 }, 5000, 'within'],
    [{ low: 1001, high: 5000 }, 5001, 'above'],
    [{ low: 180, high: 180 }, 180, 'within'],
    [{ low: 0, high: 0 }, 3, 'above'],
  ] as const)('should read %o against %i measured as %s', (bounds, measured, state) => {
    expect(comparisonStateOf(bounds, measured)).toBe(state);
  });

  it('should read a declared kind with nothing measured as none measured, not below', () => {
    expect(comparisonStateOf({ low: 51, high: 250 }, 0)).toBe('none_measured');
  });

  it('should read an unanswered kind as not declared, whatever is measured', () => {
    expect(comparisonStateOf(null, 12)).toBe('not_declared');
  });
});

describe('compareDeclaredEstate', () => {
  it('should list every kind in the questionnaire order with its bounds, measure and state', () => {
    const comparison = compareDeclaredEstate(
      [{ kind: 'servers', bounds: { low: 51, high: 250 } }],
      [row('host', 'server', 40), row('host', 'virtual_machine', 20), row('host', 'workstation', 8)],
    );

    expect(comparison).toHaveLength(12);
    expect(comparison[0]).toEqual({ kind: 'workstations', bounds: null, measured: 8, state: 'not_declared' });
    expect(comparison.find((entry) => entry.kind === 'servers')).toEqual({ kind: 'servers', bounds: { low: 51, high: 250 }, measured: 60, state: 'within' });
  });
});
