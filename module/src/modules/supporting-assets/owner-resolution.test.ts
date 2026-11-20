import { describe, expect, it } from 'vitest';
import type { OwnerCandidate } from './owner-resolution';
import { decideOwnerWrite, resolveOwner } from './owner-resolution';

const ada: OwnerCandidate = { id: 'user-ada', email: 'ada@acme.test', name: 'Ada Lovelace' };
const grace: OwnerCandidate = { id: 'user-grace', email: 'grace@acme.test', name: 'Grace Hopper' };
const otherAda: OwnerCandidate = { id: 'user-ada-2', email: 'ada.l@acme.test', name: 'ada lovelace' };

describe('resolveOwner', () => {
  it('matches a single member by email, case-insensitively', () => {
    expect(resolveOwner(' ADA@acme.test ', [ada, grace])).toEqual({ status: 'matched', userId: 'user-ada' });
  });

  it('matches a single member by display name when no email matches', () => {
    expect(resolveOwner('grace hopper', [ada, grace])).toEqual({ status: 'matched', userId: 'user-grace' });
  });

  it('prefers an email match over a name match', () => {
    const named: OwnerCandidate = { id: 'user-named', email: 'x@acme.test', name: 'ada@acme.test' };
    expect(resolveOwner('ada@acme.test', [named, ada])).toEqual({ status: 'matched', userId: 'user-ada' });
  });

  it('finds no match for a name no member carries, nor for a blank text', () => {
    expect(resolveOwner('Alan Turing', [ada, grace])).toEqual({ status: 'unmatched' });
    expect(resolveOwner('   ', [ada, grace])).toEqual({ status: 'unmatched' });
  });

  it('reports several members sharing the display name as ambiguous', () => {
    expect(resolveOwner('Ada Lovelace', [ada, otherAda, grace])).toEqual({ status: 'ambiguous', count: 2 });
  });

  it('counts one member listed twice once', () => {
    expect(resolveOwner('Ada Lovelace', [ada, ada])).toEqual({ status: 'matched', userId: 'user-ada' });
  });
});

describe('decideOwnerWrite', () => {
  it('sets the owner as resolved on a single match', () => {
    expect(decideOwnerWrite('Ada Lovelace', { ownerId: null, ownerSource: null }, { status: 'matched', userId: 'user-ada' })).toEqual({
      write: { ownerId: 'user-ada', ownerSource: 'resolved' },
      report: { name: 'Ada Lovelace', outcome: 'resolved' },
    });
  });

  it('replaces an owner an earlier push resolved', () => {
    expect(decideOwnerWrite('Grace Hopper', { ownerId: 'user-ada', ownerSource: 'resolved' }, { status: 'matched', userId: 'user-grace' }).write)
      .toEqual({ ownerId: 'user-grace', ownerSource: 'resolved' });
  });

  it('leaves the owner unchanged and reports the name when nothing matches', () => {
    expect(decideOwnerWrite('Alan Turing', { ownerId: 'user-ada', ownerSource: 'resolved' }, { status: 'unmatched' })).toEqual({
      report: { name: 'Alan Turing', outcome: 'unresolved' },
    });
  });

  it('leaves the owner unchanged and reports the name on an ambiguous match', () => {
    expect(decideOwnerWrite('Ada Lovelace', { ownerId: null, ownerSource: null }, { status: 'ambiguous', count: 2 })).toEqual({
      report: { name: 'Ada Lovelace', outcome: 'ambiguous' },
    });
  });

  it('never overwrites an owner a person set by hand', () => {
    expect(decideOwnerWrite('Grace Hopper', { ownerId: 'user-ada', ownerSource: 'manual' }, { status: 'matched', userId: 'user-grace' })).toEqual({
      report: { name: 'Grace Hopper', outcome: 'kept_manual' },
    });
  });

  it('reads an owner with no recorded source as set by hand', () => {
    expect(decideOwnerWrite('Grace Hopper', { ownerId: 'user-ada', ownerSource: null }, { status: 'matched', userId: 'user-grace' }).write)
      .toBeUndefined();
  });
});
