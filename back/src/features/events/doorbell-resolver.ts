import type { DataChangedSignal } from './data-changed-hub';
import type { DoorbellTargets, QueryDependencyIndex } from './query-dependency-index';

export type ResolvingIndex = Pick<QueryDependencyIndex, 'targetsOf'>;

export type DoorbellResolver = (signal: DataChangedSignal) => DoorbellTargets;

/**
 * Resolves a doorbell to the procedures it makes stale once, however many streams receive it:
 * the hub hands every subscriber the same signal object, which keys the memo. `onResolved` runs
 * on the first resolution only, so a trace or a measurement counts doorbells, not streams.
 */
export const createDoorbellResolver = (
  index: ResolvingIndex,
  onResolved: (signal: DataChangedSignal, targets: DoorbellTargets) => void,
): DoorbellResolver => {
  const resolved = new WeakMap<DataChangedSignal, DoorbellTargets>();
  return (signal) => {
    let targets = resolved.get(signal);
    if (targets === undefined) {
      targets = index.targetsOf(signal.tables);
      resolved.set(signal, targets);
      onResolved(signal, targets);
    }
    return targets;
  };
};
