import { describe, expect, it } from 'vitest';
import { barScopes, scopeInitials } from './scope-nav-utils';

describe('scopeInitials', () => {
  it('takes the first and last words of a longer name', () => {
    expect(scopeInitials('Acme Bank Asia Pacific')).toBe('AP');
  });

  it('takes the first two letters of a single word', () => {
    expect(scopeInitials('retail')).toBe('RE');
  });

  it('ignores the spaces around and between the words', () => {
    expect(scopeInitials('  wealth   management ')).toBe('WM');
  });

  it('keeps an accented letter whole', () => {
    expect(scopeInitials('Équipe Île-de-France')).toBe('ÉÎ');
  });

  it('gives a blank name no initials', () => {
    expect(scopeInitials('   ')).toBe('');
  });
});

describe('barScopes', () => {
  const retail = { id: 'retail', name: 'Acme Retail Network' };
  const europe = { id: 'europe', name: 'Acme Bank Europe' };
  const asia = { id: 'asia', name: 'Acme Bank Asia Pacific' };
  const ids = (scopes: Array<{ id: string }>) => scopes.map((scope) => scope.id);

  it('shows every scope by name while none is unpinned', () => {
    expect(ids(barScopes([retail, europe, asia], new Set(), null))).toEqual(['asia', 'europe', 'retail']);
  });

  it('leaves an unpinned scope out', () => {
    expect(ids(barScopes([retail, europe, asia], new Set(['asia']), null))).toEqual(['europe', 'retail']);
  });

  it('puts the remembered unpinned scope after the pinned ones', () => {
    expect(ids(barScopes([retail, europe, asia], new Set(['asia']), 'asia'))).toEqual(['europe', 'retail', 'asia']);
  });

  it('ranks a remembered scope pinned again among the pinned ones', () => {
    expect(ids(barScopes([retail, europe, asia], new Set(), 'asia'))).toEqual(['asia', 'europe', 'retail']);
  });

  it('drops a remembered scope that was deleted', () => {
    expect(ids(barScopes([retail, europe], new Set(['asia']), 'asia'))).toEqual(['europe', 'retail']);
  });
});
