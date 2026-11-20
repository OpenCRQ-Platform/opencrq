import { describe, expect, it } from 'vitest';
import type { LinkDelta, StoredLink } from './manage-dependencies-utils';
import {
  applyRoleSelection,
  keysOfLinks,
  linkStateOf,
  NOTHING_LEFT_OUT,
  pageLinkSummary,
  pendingCounts,
  pendingMarker,
  pendingTotal,
  primaryLinkWrites,
  reconcileDelta,
  sameLinkState,
  setLinkRoles,
  setPageLinked,
  settleOperations,
  supportLinkWrites,
  toggleLink,
  withoutSettled,
} from './manage-dependencies-utils';

interface Row {
  id: string,
}

const row = (id: string): Row => ({ id });
const stored: StoredLink = { linkId: 'link-a', roles: ['stores'] };
const EMPTY: LinkDelta<Row> = {};
const sequentialIds = () => {
  let next = 0;
  return () => {
    next += 1;
    return `new-${String(next)}`;
  };
};

describe('toggleLink', () => {
  it('should stage the removal of a stored link', () => {
    const delta = toggleLink(EMPTY, row('a'), stored);

    expect(delta.a).toEqual({ kind: 'remove', row: row('a'), linkId: 'link-a' });
    expect(linkStateOf(delta, 'a', stored)).toEqual({ linked: false, roles: null, pending: 'remove' });
  });

  it('should stage a new link without roles', () => {
    expect(toggleLink(EMPTY, row('a'), null).a).toEqual({ kind: 'add', row: row('a'), roles: null });
  });

  it('should return to the stored state when a row is toggled twice', () => {
    expect(toggleLink(toggleLink(EMPTY, row('a'), stored), row('a'), stored)).toEqual({});
    expect(toggleLink(toggleLink(EMPTY, row('a'), null), row('a'), null)).toEqual({});
  });
});

describe('setLinkRoles', () => {
  it('should stage a new link once an unlinked row gets a role', () => {
    const delta = setLinkRoles(EMPTY, row('a'), null, ['reads']);

    expect(delta.a).toEqual({ kind: 'add', row: row('a'), roles: ['reads'] });
    expect(linkStateOf(delta, 'a', null)).toEqual({ linked: true, roles: ['reads'], pending: 'add' });
  });

  it('should drop a pending addition once its last role is removed', () => {
    const added = setLinkRoles(EMPTY, row('a'), null, ['reads']);

    expect(setLinkRoles(added, row('a'), null, [])).toEqual({});
  });

  it('should stage an edit when the roles differ from the stored ones', () => {
    const delta = setLinkRoles(EMPTY, row('a'), stored, ['stores', 'monitors']);

    expect(delta.a).toEqual({ kind: 'edit', row: row('a'), linkId: 'link-a', roles: ['stores', 'monitors'] });
    expect(linkStateOf(delta, 'a', stored)).toEqual({ linked: true, roles: ['stores', 'monitors'], pending: 'edit' });
  });

  it('should drop the edit once the roles are back to the stored ones, in any order', () => {
    const stores2: StoredLink = { linkId: 'link-a', roles: ['stores', 'monitors'] };
    const edited = setLinkRoles(EMPTY, row('a'), stores2, ['stores']);

    expect(setLinkRoles(edited, row('a'), stores2, ['monitors', 'stores'])).toEqual({});
  });

  it('should stage the removal of a stored link once its last role is removed', () => {
    const edited = setLinkRoles(EMPTY, row('a'), stored, ['monitors']);

    expect(setLinkRoles(edited, row('a'), stored, []).a).toEqual({ kind: 'remove', row: row('a'), linkId: 'link-a' });
  });

  it('should relink a removed row, and undo the removal when it gets its stored roles back', () => {
    const removed = setLinkRoles(EMPTY, row('a'), stored, []);

    expect(setLinkRoles(removed, row('a'), stored, ['reads']).a).toEqual({ kind: 'edit', row: row('a'), linkId: 'link-a', roles: ['reads'] });
    expect(setLinkRoles(removed, row('a'), stored, ['stores'])).toEqual({});
  });
});

describe('applyRoleSelection', () => {
  it('should take the first role of an unlinked row', () => {
    expect(applyRoleSelection([], ['stores'])).toEqual(['stores']);
  });

  it('should drop unknown when a role is picked', () => {
    expect(applyRoleSelection(['unknown'], ['unknown', 'stores'])).toEqual(['stores']);
  });

  it('should keep only unknown when unknown is picked', () => {
    expect(applyRoleSelection(['stores', 'reads'], ['stores', 'reads', 'unknown'])).toEqual(['unknown']);
  });

  it('should leave no role when the last one is removed, unknown included', () => {
    expect(applyRoleSelection(['stores'], [])).toEqual([]);
    expect(applyRoleSelection(['unknown'], [])).toEqual([]);
  });

  it('should remove a role and keep the canonical order', () => {
    expect(applyRoleSelection(['stores', 'reads', 'monitors'], ['stores', 'monitors'])).toEqual(['stores', 'monitors']);
  });
});

describe('counts and marker', () => {
  const delta: LinkDelta<Row> = {
    a: { kind: 'add', row: row('a'), roles: null },
    b: { kind: 'add', row: row('b'), roles: null },
    c: { kind: 'remove', row: row('c'), linkId: 'link-c' },
    d: { kind: 'edit', row: row('d'), linkId: 'link-d', roles: ['reads'] },
  };

  it('should count each kind of change', () => {
    expect(pendingCounts(delta)).toEqual({ added: 2, removed: 1, edited: 1 });
    expect(pendingTotal([delta, { e: { kind: 'add', row: row('e'), roles: null } }])).toBe(5);
  });

  it('should write only the non-zero parts of the marker', () => {
    expect(pendingMarker(pendingCounts(delta))).toBe('+2 −1 ~1');
    expect(pendingMarker({ added: 0, removed: 3, edited: 0 })).toBe('−3');
    expect(pendingMarker({ added: 0, removed: 0, edited: 0 })).toBe('');
  });
});

describe('setPageLinked', () => {
  const page = [
    { row: row('a'), stored: null },
    { row: row('b'), stored: { linkId: 'link-b', roles: null } },
    { row: row('c'), stored: null },
  ];

  it('should link every unlinked row of the page and leave the linked ones alone', () => {
    expect(Object.keys(setPageLinked(EMPTY, page, true))).toEqual(['a', 'c']);
  });

  it('should unlink every linked row of the page, undoing the pending additions', () => {
    const linked = setPageLinked(EMPTY, page, true);

    expect(setPageLinked(linked, page, false)).toEqual({
      b: { kind: 'remove', row: row('b'), linkId: 'link-b' },
    });
  });
});

describe('sameLinkState', () => {
  it('should compare the roles by content', () => {
    expect(sameLinkState({ linked: true, roles: ['stores'], pending: 'add' }, { linked: true, roles: ['stores'], pending: 'add' })).toBe(true);
    expect(sameLinkState({ linked: true, roles: ['stores'], pending: 'add' }, { linked: true, roles: ['reads'], pending: 'add' })).toBe(false);
    expect(sameLinkState({ linked: false, roles: null, pending: null }, { linked: false, roles: null, pending: 'remove' })).toBe(false);
  });
});

describe('pageLinkSummary', () => {
  const linked = { linked: true, roles: null, pending: null };
  const unlinked = { linked: false, roles: null, pending: null };

  it('should say how many rows of the page are linked', () => {
    expect(pageLinkSummary([])).toBe('empty');
    expect(pageLinkSummary([unlinked, unlinked])).toBe('none');
    expect(pageLinkSummary([linked, unlinked])).toBe('some');
    expect(pageLinkSummary([linked, linked])).toBe('all');
  });
});

describe('settleOperations', () => {
  it('should report the changes each successful request stored, and count the failed ones', async () => {
    const { settled, failed, skipped } = await settleOperations([
      { list: 'dependsOn', ids: ['a'], run: () => Promise.resolve(NOTHING_LEFT_OUT) },
      { list: 'dependsOn', ids: ['b', 'c'], run: () => Promise.reject(new Error('conflict')) },
      { list: 'primary', ids: ['d'], run: () => Promise.resolve(NOTHING_LEFT_OUT) },
    ]);

    expect([...(settled.get('dependsOn') ?? [])]).toEqual(['a']);
    expect([...(settled.get('primary') ?? [])]).toEqual(['d']);
    expect(failed).toBe(2);
    expect(skipped).toBe(0);
  });

  it('should leave the changes a successful request skipped unsettled, and count them apart', async () => {
    const { settled, failed, skipped } = await settleOperations([
      { list: 'primary', ids: ['a', 'b', 'c'], run: () => Promise.resolve({ skipped: ['b'], gone: [] }) },
    ]);

    expect([...(settled.get('primary') ?? [])]).toEqual(['a', 'c']);
    expect(failed).toBe(0);
    expect(skipped).toBe(1);
  });

  it('should settle the changes whose asset is gone, and count them apart', async () => {
    const { settled, skipped, gone } = await settleOperations([
      { list: 'dependsOn', ids: ['a', 'b'], run: () => Promise.resolve({ skipped: [], gone: ['b'] }) },
    ]);

    expect([...(settled.get('dependsOn') ?? [])]).toEqual(['a', 'b']);
    expect(skipped).toBe(0);
    expect(gone).toBe(1);
  });

  it('should run at most four requests at a time, and still run them all', async () => {
    let inFlight = 0;
    let mostInFlight = 0;
    const run = async () => {
      inFlight += 1;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return NOTHING_LEFT_OUT;
    };
    const operations = Array.from({ length: 10 }, (_, index) => ({ list: 'primary', ids: [`id-${String(index)}`], run }));

    const { settled } = await settleOperations(operations);

    expect(mostInFlight).toBe(4);
    expect(settled.get('primary')?.size).toBe(10);
  });
});

describe('keysOfLinks', () => {
  it('should map the skipped link ids of a create back to their keys', () => {
    const [write] = primaryLinkWrites({
      a: { kind: 'add', row: row('a'), roles: null },
      b: { kind: 'add', row: row('b'), roles: null },
    }, (key) => ({ supportingAssetId: 'self', primaryAssetId: key }), sequentialIds());

    expect(keysOfLinks(write, ['new-2'])).toEqual(['b']);
  });

  it('should map the gone link ids of a supporting-to-supporting create back to their keys', () => {
    const [write] = supportLinkWrites({
      a: { kind: 'add', row: row('a'), roles: null },
      b: { kind: 'add', row: row('b'), roles: null },
    }, 'self', 'dependsOn', sequentialIds());

    expect(keysOfLinks(write, ['new-1'])).toEqual(['a']);
  });

  it('should map the skipped link ids of an update back to their keys', () => {
    const [write] = primaryLinkWrites({
      a: { kind: 'edit', row: row('a'), linkId: 'link-a', roles: ['reads'] },
      b: { kind: 'edit', row: row('b'), linkId: 'link-b', roles: ['stores'] },
    }, (key) => ({ supportingAssetId: 'self', primaryAssetId: key }), sequentialIds());

    expect(keysOfLinks(write, ['link-a'])).toEqual(['a']);
  });

  it('should skip nothing when the server reports nothing', () => {
    const [write] = supportLinkWrites({ a: { kind: 'remove', row: row('a'), linkId: 'link-a' } }, 'self', 'dependsOn', sequentialIds());

    expect(keysOfLinks(write, [])).toEqual([]);
  });
});

describe('withoutSettled', () => {
  it('should keep only the changes whose save did not succeed', () => {
    const delta: LinkDelta<Row> = {
      a: { kind: 'add', row: row('a'), roles: null },
      b: { kind: 'remove', row: row('b'), linkId: 'link-b' },
    };

    expect(Object.keys(withoutSettled(delta, new Set(['a'])))).toEqual(['b']);
  });
});

describe('reconcileDelta', () => {
  const storedIn = (links: Record<string, StoredLink>) => (id: string) => links[id] ?? null;

  it('should return the delta itself when every change still applies', () => {
    const delta: LinkDelta<Row> = {
      a: { kind: 'add', row: row('a'), roles: ['reads'] },
      b: { kind: 'remove', row: row('b'), linkId: 'link-b' },
      c: { kind: 'edit', row: row('c'), linkId: 'link-c', roles: ['reads'] },
    };

    expect(reconcileDelta(delta, storedIn({ b: { linkId: 'link-b', roles: ['stores'] }, c: { linkId: 'link-c', roles: ['stores'] } }))).toBe(delta);
  });

  it('should drop an addition someone else stored since, with the same roles or none', () => {
    const delta: LinkDelta<Row> = {
      a: { kind: 'add', row: row('a'), roles: ['stores'] },
      b: { kind: 'add', row: row('b'), roles: null },
    };

    expect(reconcileDelta(delta, storedIn({ a: stored, b: { linkId: 'link-b', roles: null } }))).toEqual({});
  });

  it('should turn an addition stored since with other roles into an edit of that link', () => {
    const delta: LinkDelta<Row> = { a: { kind: 'add', row: row('a'), roles: ['reads'] } };

    expect(reconcileDelta(delta, storedIn({ a: stored })).a).toEqual({ kind: 'edit', row: row('a'), linkId: 'link-a', roles: ['reads'] });
  });

  it('should drop the removal of a link already gone', () => {
    const delta: LinkDelta<Row> = { a: { kind: 'remove', row: row('a'), linkId: 'link-a' } };

    expect(reconcileDelta(delta, storedIn({}))).toEqual({});
  });

  it('should turn the edit of a link gone since into an addition with the edited roles', () => {
    const delta: LinkDelta<Row> = { a: { kind: 'edit', row: row('a'), linkId: 'link-a', roles: ['reads'] } };

    expect(reconcileDelta(delta, storedIn({})).a).toEqual({ kind: 'add', row: row('a'), roles: ['reads'] });
  });

  it('should drop an edit the stored link already carries', () => {
    const delta: LinkDelta<Row> = { a: { kind: 'edit', row: row('a'), linkId: 'link-a', roles: ['stores'] } };

    expect(reconcileDelta(delta, storedIn({ a: stored }))).toEqual({});
  });

  it('should aim a removal or an edit at the link that replaced the one it was staged on', () => {
    const delta: LinkDelta<Row> = {
      a: { kind: 'remove', row: row('a'), linkId: 'old-a' },
      b: { kind: 'edit', row: row('b'), linkId: 'old-b', roles: ['reads'] },
    };

    const reconciled = reconcileDelta(delta, storedIn({ a: stored, b: { linkId: 'link-b', roles: ['stores'] } }));

    expect(reconciled.a).toEqual({ kind: 'remove', row: row('a'), linkId: 'link-a' });
    expect(reconciled.b).toEqual({ kind: 'edit', row: row('b'), linkId: 'link-b', roles: ['reads'] });
  });
});

describe('primaryLinkWrites', () => {
  const ofSupportingAsset = (primaryAssetId: string) => ({ supportingAssetId: 'edited', primaryAssetId });

  it('should send one create, one update and one delete, each naming the changes it settles', () => {
    const delta: LinkDelta<Row> = {
      a: { kind: 'add', row: row('a'), roles: ['reads'] },
      b: { kind: 'edit', row: row('b'), linkId: 'link-b', roles: ['stores'] },
      c: { kind: 'remove', row: row('c'), linkId: 'link-c' },
      d: { kind: 'add', row: row('d'), roles: ['monitors'] },
    };

    expect(primaryLinkWrites(delta, ofSupportingAsset, sequentialIds())).toEqual([
      {
        kind: 'createPrimary',
        ids: ['a', 'd'],
        links: [
          { id: 'new-1', supportingAssetId: 'edited', primaryAssetId: 'a', roles: ['reads'] },
          { id: 'new-2', supportingAssetId: 'edited', primaryAssetId: 'd', roles: ['monitors'] },
        ],
      },
      { kind: 'updatePrimary', ids: ['b'], links: [{ id: 'link-b', roles: ['stores'] }] },
      { kind: 'deletePrimary', ids: ['c'], linkIds: ['link-c'] },
    ]);
  });

  it('should place the key on the side the list names', () => {
    const delta: LinkDelta<Row> = { a: { kind: 'add', row: row('a'), roles: ['reads'] } };

    const [write] = primaryLinkWrites(delta, (supportingAssetId) => ({ supportingAssetId, primaryAssetId: 'edited' }), sequentialIds());

    expect(write).toEqual({ kind: 'createPrimary', ids: ['a'], links: [{ id: 'new-1', supportingAssetId: 'a', primaryAssetId: 'edited', roles: ['reads'] }] });
  });

  it('should send nothing for an empty delta', () => {
    expect(primaryLinkWrites(EMPTY, ofSupportingAsset, sequentialIds())).toEqual([]);
  });
});

describe('supportLinkWrites', () => {
  it('should split the changes of one kind into requests of as many links as one call takes', () => {
    const delta: LinkDelta<Row> = Object.fromEntries(Array.from({ length: 1001 }, (_, index) => {
      const key = `asset-${String(index)}`;
      return [key, { kind: 'add', row: row(key), roles: null }];
    }));

    const writes = supportLinkWrites(delta, 'self', 'dependsOn', sequentialIds());

    expect(writes.map((write) => [write.kind, write.ids.length])).toEqual([['createSupport', 500], ['createSupport', 500], ['createSupport', 1]]);
    expect(writes.flatMap((write) => write.ids)).toEqual(Object.keys(delta));
    expect(writes[2]).toEqual({ kind: 'createSupport', ids: ['asset-1000'], links: [{ id: 'new-1001', providerAssetId: 'asset-1000', dependentAssetId: 'self' }] });
  });

  const delta: LinkDelta<Row> = {
    a: { kind: 'add', row: row('a'), roles: null },
    b: { kind: 'remove', row: row('b'), linkId: 'link-b' },
  };
  const fixedId = () => 'new';

  it('should make the other asset the provider of the edited one on dependsOn', () => {
    expect(supportLinkWrites(delta, 'edited', 'dependsOn', fixedId)).toEqual([
      { kind: 'createSupport', ids: ['a'], links: [{ id: 'new', providerAssetId: 'a', dependentAssetId: 'edited' }] },
      { kind: 'deleteSupport', ids: ['b'], linkIds: ['link-b'] },
    ]);
  });

  it('should make the edited asset the provider of the other one on providesTo', () => {
    expect(supportLinkWrites(delta, 'edited', 'providesTo', fixedId)[0]).toEqual({
      kind: 'createSupport',
      ids: ['a'],
      links: [{ id: 'new', providerAssetId: 'edited', dependentAssetId: 'a' }],
    });
  });
});
