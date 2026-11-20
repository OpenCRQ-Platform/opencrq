import { describe, expect, it } from 'vitest';
import { afterPinChanged, afterPinFailed, afterScopeOpened, EMPTY_SCOPE_MEMORY, withPinned } from './scope-memory-utils';

describe('afterScopeOpened', () => {
  it('remembers an unpinned scope as the bar entry', () => {
    expect(afterScopeOpened(EMPTY_SCOPE_MEMORY, 'asia', new Set(['asia'])))
      .toEqual({ lastScopeId: 'asia', unpinnedScopeId: 'asia' });
  });

  it('keeps the bar entry when a pinned scope is opened', () => {
    expect(afterScopeOpened({ lastScopeId: 'asia', unpinnedScopeId: 'asia' }, 'europe', new Set(['asia'])))
      .toEqual({ lastScopeId: 'europe', unpinnedScopeId: 'asia' });
  });

  it('replaces the bar entry with the next unpinned scope opened', () => {
    expect(afterScopeOpened({ lastScopeId: 'asia', unpinnedScopeId: 'asia' }, 'wealth', new Set(['asia', 'wealth'])))
      .toEqual({ lastScopeId: 'wealth', unpinnedScopeId: 'wealth' });
  });
});

describe('afterPinChanged', () => {
  it('turns the scope the user is in into the bar entry when it is unpinned', () => {
    expect(afterPinChanged({ lastScopeId: 'europe', unpinnedScopeId: 'asia' }, 'europe', false))
      .toEqual({ lastScopeId: 'europe', unpinnedScopeId: 'europe' });
  });

  it('leaves the bar entry alone when another scope is unpinned', () => {
    expect(afterPinChanged({ lastScopeId: 'europe', unpinnedScopeId: 'asia' }, 'retail', false))
      .toEqual({ lastScopeId: 'europe', unpinnedScopeId: 'asia' });
  });

  it('frees the bar entry when its scope is pinned', () => {
    expect(afterPinChanged({ lastScopeId: 'europe', unpinnedScopeId: 'asia' }, 'asia', true))
      .toEqual({ lastScopeId: 'europe', unpinnedScopeId: null });
  });
});

describe('afterPinFailed', () => {
  it('brings back the bar entry a refused pin removed', () => {
    const before = { lastScopeId: 'europe', unpinnedScopeId: 'asia' };
    const after = afterPinChanged(before, 'asia', true);

    expect(afterPinFailed(after, before, after)).toEqual(before);
  });

  it('removes the bar entry a refused unpin added', () => {
    const before = { lastScopeId: 'europe', unpinnedScopeId: 'asia' };
    const after = afterPinChanged(before, 'europe', false);

    expect(afterPinFailed(after, before, after)).toEqual(before);
  });

  it('keeps a bar entry opened while the pin was in flight', () => {
    const before = { lastScopeId: 'europe', unpinnedScopeId: 'asia' };
    const after = afterPinChanged(before, 'asia', true);
    const opened = afterScopeOpened(after, 'wealth', new Set(['wealth']));

    expect(afterPinFailed(opened, before, after)).toEqual(opened);
  });
});

describe('withPinned', () => {
  it('drops a pinned scope from the unpinned ids', () => {
    expect(withPinned(['asia', 'wealth'], 'asia', true)).toEqual(['wealth']);
  });

  it('adds an unpinned scope once', () => {
    expect(withPinned(['asia'], 'asia', false)).toEqual(['asia']);
    expect(withPinned(['asia'], 'wealth', false)).toEqual(['asia', 'wealth']);
  });
});
