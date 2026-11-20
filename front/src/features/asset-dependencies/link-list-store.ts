import type { SupportToPrimaryLinkRole } from '@app/module/client';
import type { LinkState } from './manage-dependencies-utils';
import { sameLinkState } from './manage-dependencies-utils';

/** What a list's cells read and call, rebuilt by the list on each render. */
export type LinkListValue = { stateOf: (id: string) => LinkState } & (
  | {
    kind: 'roles',
    setRoles: (id: string, roles: Array<SupportToPrimaryLinkRole>) => void,
  }
  | { kind: 'checkbox', toggle: (id: string) => void, pageStates: ReadonlyArray<LinkState>, setPageLinked: (linked: boolean) => void }
);

/**
 * Hands a list's latest value to its cells outside the table's own render, so a change re-renders
 * only the cells whose row it changed rather than every row of the page.
 */
export interface LinkListStore {
  current: () => LinkListValue,
  publish: (value: LinkListValue) => void,
  subscribe: (listener: () => void) => () => void,
  /** A row's state, the same object for as long as it does not change, which `useSyncExternalStore` relies on. */
  rowState: (id: string) => LinkState,
}

export const createLinkListStore = (initial: LinkListValue): LinkListStore => {
  let value = initial;
  const listeners = new Set<() => void>();
  const rowStates = new Map<string, LinkState>();
  return {
    current: () => value,
    publish: (next) => {
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    rowState: (id) => {
      const next = value.stateOf(id);
      const previous = rowStates.get(id);
      if (previous !== undefined && sameLinkState(previous, next)) {
        return previous;
      }
      rowStates.set(id, next);
      return next;
    },
  };
};
