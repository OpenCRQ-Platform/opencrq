import { describe, expect, it } from 'vitest';
import { resolveActor } from './actor-utils';

describe('resolveActor', () => {
  it('names the user when only a user is there', () => {
    expect(resolveActor('Jamie Doe', null)).toEqual({ kind: 'user', label: 'Jamie Doe' });
  });

  it('names a named service account', () => {
    expect(resolveActor(null, { id: 'sa-1', name: 'Sync Bot' })).toEqual({ kind: 'serviceAccount', id: 'sa-1', name: 'Sync Bot' });
  });

  it('keeps a service account whose name is hidden, with a null name', () => {
    expect(resolveActor(null, { id: 'sa-1', name: null })).toEqual({ kind: 'serviceAccount', id: 'sa-1', name: null });
  });

  it('turns a blank service account name into null', () => {
    expect(resolveActor(null, { id: 'sa-1', name: '   ' })).toEqual({ kind: 'serviceAccount', id: 'sa-1', name: null });
  });

  it('lets the user win when both are there', () => {
    expect(resolveActor('Jamie Doe', { id: 'sa-1', name: 'Sync Bot' })).toEqual({ kind: 'user', label: 'Jamie Doe' });
  });

  it('falls back to the service account when the user label is blank', () => {
    expect(resolveActor('  ', { id: 'sa-1', name: 'Sync Bot' })).toEqual({ kind: 'serviceAccount', id: 'sa-1', name: 'Sync Bot' });
  });

  it('returns null when nobody did it', () => {
    expect(resolveActor(null, null)).toBeNull();
    expect(resolveActor('', null)).toBeNull();
  });
});
