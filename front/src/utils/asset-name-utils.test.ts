import { describe, expect, it } from 'vitest';
import { assetNameDisplay, assetNameMatches, assetNameText } from './asset-name-utils';

describe('assetNameDisplay', () => {
  it('shows the real name when there is one, ahead of the derived name', () => {
    expect(assetNameDisplay({ name: 'srv-01', derivedName: '10.0.0.1' })).toEqual({ kind: 'name', text: 'srv-01' });
  });

  it('falls back to the derived name when the name is absent', () => {
    expect(assetNameDisplay({ name: null, derivedName: '10.0.0.1' })).toEqual({ kind: 'derived', text: '10.0.0.1' });
  });

  it('is unnamed when neither is present', () => {
    expect(assetNameDisplay({ name: null, derivedName: null })).toEqual({ kind: 'unnamed' });
  });

  it('counts a blank string as absent', () => {
    expect(assetNameDisplay({ name: '   ', derivedName: '10.0.0.1' })).toEqual({ kind: 'derived', text: '10.0.0.1' });
    expect(assetNameDisplay({ name: '', derivedName: '  ' })).toEqual({ kind: 'unnamed' });
    expect(assetNameDisplay({ name: null, derivedName: '' })).toEqual({ kind: 'unnamed' });
  });
});

describe('assetNameText', () => {
  it('returns the name, then the derived name', () => {
    expect(assetNameText({ name: 'srv-01', derivedName: '10.0.0.1' }, 'Unnamed asset')).toBe('srv-01');
    expect(assetNameText({ name: null, derivedName: '10.0.0.1' }, 'Unnamed asset')).toBe('10.0.0.1');
  });

  it('returns the injected label when the asset has no name at all', () => {
    expect(assetNameText({ name: ' ', derivedName: null }, 'Actif sans nom')).toBe('Actif sans nom');
  });
});

describe('assetNameMatches', () => {
  it('matches the shown name regardless of case', () => {
    expect(assetNameMatches({ name: 'Mail Server', derivedName: null }, 'mail')).toBe(true);
    expect(assetNameMatches({ name: 'Mail Server', derivedName: null }, 'web')).toBe(false);
  });

  it('matches the derived name when the asset has no name', () => {
    expect(assetNameMatches({ name: null, derivedName: '10.0.0.1' }, '10.0.')).toBe(true);
  });

  it('does not look in the derived name of an asset that has a name, as the server does not', () => {
    expect(assetNameMatches({ name: 'srv-01', derivedName: '10.0.0.1' }, '10.0.')).toBe(false);
  });

  it('matches nothing on an unnamed asset', () => {
    expect(assetNameMatches({ name: null, derivedName: null }, 'unnamed')).toBe(false);
  });
});

describe('assetNameMatches accents', () => {
  it('should find an accented or ligatured name from its plain spelling', () => {
    expect(assetNameMatches({ name: 'École Straße', derivedName: null }, 'ecole')).toBe(true);
    expect(assetNameMatches({ name: 'École Straße', derivedName: null }, 'strasse')).toBe(true);
  });

  it('should find a plain name from an accented search', () => {
    expect(assetNameMatches({ name: 'ecole', derivedName: null }, 'éco')).toBe(true);
  });
});
