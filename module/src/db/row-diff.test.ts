import { describe, expect, it } from 'vitest';
import { diffRows } from './row-diff';

interface Link { id: string, requirementId: string, controlId: string }
interface WantedLink { requirementId: string, controlId: string }

const keyOfHeld = (link: Link) => `${link.requirementId}::${link.controlId}`;
const keyOfWanted = (link: WantedLink) => `${link.requirementId}::${link.controlId}`;
const diff = (held: Array<Link>, wanted: Array<WantedLink>) => {
  const { stale, missing } = diffRows(held, wanted, keyOfHeld, keyOfWanted);
  return { staleIds: stale.map((link) => link.id), missing };
};

describe('diffRows', () => {
  it('should leave identical sets alone', () => {
    const held = [{ id: 'l1', requirementId: 'r1', controlId: 'c1' }, { id: 'l2', requirementId: 'r1', controlId: 'c2' }];
    const wanted = [{ requirementId: 'r1', controlId: 'c2' }, { requirementId: 'r1', controlId: 'c1' }];

    expect(diff(held, wanted)).toEqual({ staleIds: [], missing: [] });
  });

  it('should return a row that is wanted and not held as missing', () => {
    const held = [{ id: 'l1', requirementId: 'r1', controlId: 'c1' }];
    const wanted = [{ requirementId: 'r1', controlId: 'c1' }, { requirementId: 'r1', controlId: 'c2' }];

    expect(diff(held, wanted)).toEqual({ staleIds: [], missing: [{ requirementId: 'r1', controlId: 'c2' }] });
  });

  it('should return a row that is held and no longer wanted as stale', () => {
    const held = [{ id: 'l1', requirementId: 'r1', controlId: 'c1' }, { id: 'l2', requirementId: 'r1', controlId: 'c2' }];
    const wanted = [{ requirementId: 'r1', controlId: 'c1' }];

    expect(diff(held, wanted)).toEqual({ staleIds: ['l2'], missing: [] });
  });

  it('should replace only the row whose value changed', () => {
    const held = [{ id: 'l1', requirementId: 'r1', controlId: 'c1' }, { id: 'l2', requirementId: 'r1', controlId: 'c2' }];
    const wanted = [{ requirementId: 'r1', controlId: 'c1' }, { requirementId: 'r1', controlId: 'c3' }];

    expect(diff(held, wanted)).toEqual({ staleIds: ['l2'], missing: [{ requirementId: 'r1', controlId: 'c3' }] });
  });

  it('should keep the first of a duplicated held row and mark the others stale', () => {
    const held = [
      { id: 'l1', requirementId: 'r1', controlId: 'c1' },
      { id: 'l2', requirementId: 'r1', controlId: 'c1' },
      { id: 'l3', requirementId: 'r1', controlId: 'c1' },
    ];

    expect(diff(held, [{ requirementId: 'r1', controlId: 'c1' }])).toEqual({ staleIds: ['l2', 'l3'], missing: [] });
  });

  it('should insert a duplicated wanted row once', () => {
    const wanted = [{ requirementId: 'r1', controlId: 'c1' }, { requirementId: 'r1', controlId: 'c1' }];

    expect(diff([], wanted)).toEqual({ staleIds: [], missing: [{ requirementId: 'r1', controlId: 'c1' }] });
  });

  it('should return the missing rows in the order they are wanted', () => {
    const wanted = [{ requirementId: 'r2', controlId: 'c1' }, { requirementId: 'r1', controlId: 'c1' }, { requirementId: 'r1', controlId: 'c0' }];

    expect(diff([], wanted).missing).toEqual(wanted);
  });

  it('should return two empty lists for two empty sets', () => {
    expect(diff([], [])).toEqual({ staleIds: [], missing: [] });
  });
});
