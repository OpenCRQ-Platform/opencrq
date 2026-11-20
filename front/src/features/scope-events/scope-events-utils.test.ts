import { describe, expect, it } from 'vitest';
import { deletedSinceCount, mappingEventTypeOf, mergeScopeEvents, valueEventTypeOf } from './scope-events-utils';

describe('mergeScopeEvents', () => {
  it('should list the events of every journal newest first', () => {
    const merged = mergeScopeEvents(
      [{ id: 'a', createdAt: '2026-11-05T10:00:00Z' }, { id: 'b', createdAt: '2026-11-03T10:00:00Z' }],
      [{ id: 'c', createdAt: new Date('2026-11-04T10:00:00Z') }],
    );

    expect(merged.map((event) => event.id)).toEqual(['a', 'c', 'b']);
  });

  it('should order the events of one save by id, the latest first', () => {
    const at = '2026-11-05T10:00:00Z';

    expect(mergeScopeEvents([{ id: '01', createdAt: at }], [{ id: '02', createdAt: at }]).map((event) => event.id)).toEqual(['02', '01']);
  });
});

describe('valueEventTypeOf', () => {
  it('should read a first answer as set, a removed one as clear and any other as change', () => {
    expect(valueEventTypeOf(null, 12)).toBe('set');
    expect(valueEventTypeOf('Acme', null)).toBe('clear');
    expect(valueEventTypeOf(false, true)).toBe('change');
  });
});

describe('mappingEventTypeOf', () => {
  it('should read a save that only adds as set and one that only removes as clear', () => {
    expect(mappingEventTypeOf({ addedCount: 3, removedCount: 0, estateMode: null })).toBe('set');
    expect(mappingEventTypeOf({ addedCount: 0, removedCount: 2, estateMode: null })).toBe('clear');
  });

  it('should read a save that adds and removes, or switches the estate mode, as change', () => {
    expect(mappingEventTypeOf({ addedCount: 3, removedCount: 1, estateMode: null })).toBe('change');
    expect(mappingEventTypeOf({ addedCount: 0, removedCount: 2, estateMode: { from: 'open', to: 'closed' } })).toBe('change');
  });
});

describe('deletedSinceCount', () => {
  it('should count the assets the detail no longer lists', () => {
    expect(deletedSinceCount({ addedCount: 12, removedCount: 3 }, 13)).toBe(2);
    expect(deletedSinceCount({ addedCount: 1, removedCount: 0 }, 1)).toBe(0);
  });
});
