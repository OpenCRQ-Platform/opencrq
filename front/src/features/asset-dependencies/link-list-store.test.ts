import { describe, expect, it, vi } from 'vitest';
import type { LinkListValue } from './link-list-store';
import type { LinkDelta, StoredLink } from './manage-dependencies-utils';
import { createLinkListStore } from './link-list-store';
import { linkStateOf, setLinkRoles } from './manage-dependencies-utils';

const stored = new Map<string, StoredLink>([['a', { linkId: 'link-a', roles: ['stores'] }]]);

const valueOf = (delta: LinkDelta<{ id: string }>): LinkListValue => ({
  kind: 'roles',
  stateOf: (id) => linkStateOf(delta, id, stored.get(id) ?? null),
  setRoles: () => undefined,
});

describe('createLinkListStore', () => {
  it('should keep handing out the same state for a row the change left alone', () => {
    const store = createLinkListStore(valueOf({}));
    const before = { a: store.rowState('a'), b: store.rowState('b') };

    store.publish(valueOf(setLinkRoles({}, { id: 'b' }, null, ['reads'])));

    expect(store.rowState('a')).toBe(before.a);
    expect(store.rowState('b')).not.toBe(before.b);
    expect(store.rowState('b')).toEqual({ linked: true, roles: ['reads'], pending: 'add' });
  });

  it('should tell its subscribers of each value, until they unsubscribe', () => {
    const store = createLinkListStore(valueOf({}));
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.publish(valueOf({}));
    unsubscribe();
    store.publish(valueOf({}));

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
