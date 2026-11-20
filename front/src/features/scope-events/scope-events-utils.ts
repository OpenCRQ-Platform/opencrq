export type ScopeEventSource = 'identity' | 'financialProfile' | 'declaredEstate' | 'assets';

export type ScopeEventType = 'set' | 'change' | 'clear';

export interface DatedEvent {
  readonly id: string,
  readonly createdAt: Date | string,
}

/** Newest first; the events of one save share a date and keep a stable order. */
export const mergeScopeEvents = <T extends DatedEvent>(...journals: ReadonlyArray<ReadonlyArray<T>>): Array<T> => journals
  .flat()
  .toSorted((first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime() || second.id.localeCompare(first.id));

export const valueEventTypeOf = (before: unknown, after: unknown): ScopeEventType => {
  if (before === null) {
    return 'set';
  }
  return after === null ? 'clear' : 'change';
};

export const mappingEventTypeOf = (event: { addedCount: number, removedCount: number, estateMode: unknown }): ScopeEventType => {
  if (event.estateMode !== null || (event.addedCount > 0 && event.removedCount > 0)) {
    return 'change';
  }
  return event.removedCount > 0 ? 'clear' : 'set';
};

/** The assets a save mapped or unmapped that are gone since, which the event's detail can no longer list. */
export const deletedSinceCount = (event: { addedCount: number, removedCount: number }, listed: number): number =>
  Math.max(0, event.addedCount + event.removedCount - listed);
