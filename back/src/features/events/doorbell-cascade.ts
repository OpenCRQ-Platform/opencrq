import type { DoorbellParent, DoorbellTopology } from '@app/module';
import { createDoorbellTopology } from '@app/module';
import { EVERY_TABLE } from './data-changed-hub';

export interface DoorbellCascadeOptions {
  loadParents: () => Promise<Array<DoorbellParent>>,
  onLoadFailed?: (error: unknown) => void,
}

export type DoorbellCascade = (change: { table: string, op: string | null | undefined }) => Promise<ReadonlySet<string>>;

/**
 * Expands a change into the tables it changes, the silenced children of a deleted parent included.
 * The topology is loaded on the first change rather than at activation, when the database is not
 * connected yet, and never reloaded: a trigger a migration adds cannot ring before that migration
 * ran, so the first change already sees the current topology. Changes are expanded one behind the
 * other so they ring in the order they landed. A load that fails is not retained: the change it
 * served rings for every table, and the next change loads again.
 */
export const createDoorbellCascade = ({ loadParents, onLoadFailed }: DoorbellCascadeOptions): DoorbellCascade => {
  let topology: DoorbellTopology | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  return (change) => {
    const expanded = chain.then(async () => {
      topology ??= createDoorbellTopology(await loadParents());
      return topology.tablesChangedBy(change.table, change.op);
    }).catch((error: unknown) => {
      onLoadFailed?.(error);
      return new Set([EVERY_TABLE]);
    });
    chain = expanded;
    return expanded;
  };
};
