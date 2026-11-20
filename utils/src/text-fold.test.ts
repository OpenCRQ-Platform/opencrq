import { describe, expect, it } from 'vitest';
import { compareText, foldedMatchRanges, foldText, includesFolded } from './text-fold';

describe('foldText', () => {
  it('should fold accents, ligatures, ß and case in one pass', () => {
    expect(foldText('Œuvre Æsir Straße ẞ façade NOËL Øl Łódź Đ')).toBe('oeuvre aesir strasse ss facade noel ol lodz d');
  });

  it.each([
    ['œ', 'oe'],
    ['Œ', 'oe'],
    ['æ', 'ae'],
    ['Æ', 'ae'],
    ['ß', 'ss'],
    ['ẞ', 'ss'],
    ['ø', 'o'],
    ['Ø', 'o'],
    ['ł', 'l'],
    ['Ł', 'l'],
    ['đ', 'd'],
    ['Đ', 'd'],
    ['ð', 'd'],
    ['Ð', 'd'],
    ['þ', 'th'],
    ['Þ', 'th'],
    ['ı', 'i'],
    ['İ', 'i'],
  ])('should fold %s to %s', (letter, folded) => {
    expect(foldText(letter)).toBe(folded);
  });

  it('should treat a precomposed and a decomposed accent the same', () => {
    expect(foldText('\u00e9')).toBe('e');
    expect(foldText('e\u0301')).toBe('e');
  });

  it('should never trim', () => {
    expect(foldText('  École ')).toBe('  ecole ');
  });

  it('should leave plain ASCII, digits and symbols alone besides the case', () => {
    expect(foldText('CVE-2024-1234 (a_b)')).toBe('cve-2024-1234 (a_b)');
  });

  it('should return an empty string for an empty string', () => {
    expect(foldText('')).toBe('');
  });
});

describe('includesFolded', () => {
  it('should ignore accents and case on both sides, and trim the needle', () => {
    expect(includesFolded('École', '  ecole ')).toBe(true);
    expect(includesFolded('ecole', 'École')).toBe(true);
  });

  it('should match across a length-changing fold', () => {
    expect(includesFolded('Straße', 'strasse')).toBe(true);
    expect(includesFolded('Strasse', 'straße')).toBe(true);
    expect(includesFolded('Œuvre', 'oeuvre')).toBe(true);
  });

  it('should not match an absent needle', () => {
    expect(includesFolded('École', 'zèbre')).toBe(false);
  });

  it('should match everything for an empty or blank needle', () => {
    expect(includesFolded('École', '')).toBe(true);
    expect(includesFolded('École', '   ')).toBe(true);
  });

  it('should match a nullish haystack only against an empty needle', () => {
    expect(includesFolded(null, '')).toBe(true);
    expect(includesFolded(undefined, 'a')).toBe(false);
    expect(includesFolded(null, 'a')).toBe(false);
  });
});

describe('foldedMatchRanges', () => {
  it('should return offsets in the original string across a length-changing fold', () => {
    expect(foldedMatchRanges('Straße Œuvre', 'sse')).toEqual([[4, 6]]);
  });

  it('should widen a match on half of a letter to the whole letter', () => {
    expect(foldedMatchRanges('Straße', 'ss')).toEqual([[4, 5]]);
    expect(foldedMatchRanges('Straße', 'rass')).toEqual([[2, 5]]);
  });

  it('should keep a decomposed accent inside the range of its letter', () => {
    expect(foldedMatchRanges('cafe\u0301 noir', 'cafe')).toEqual([[0, 5]]);
    expect(foldedMatchRanges('cafe\u0301 noir', 'noir')).toEqual([[6, 10]]);
  });

  it('should match a ligature on its folded letters', () => {
    expect(foldedMatchRanges('Œuvre', 'oeuvre')).toEqual([[0, 5]]);
    expect(foldedMatchRanges('Œuvre', 'o')).toEqual([[0, 1]]);
  });

  it('should return every match left to right, ignoring accents and case', () => {
    expect(foldedMatchRanges('Éé e', 'e')).toEqual([
      [0, 1],
      [1, 2],
      [3, 4],
    ]);
  });

  it('should not overlap matches', () => {
    expect(foldedMatchRanges('aaaa', 'aa')).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(foldedMatchRanges('ß', 's')).toEqual([[0, 1]]);
  });

  it('should keep offsets in step after a character outside the BMP', () => {
    expect(foldedMatchRanges('🚀 deploy ok', 'deploy')).toEqual([[3, 9]]);

    const line = '🚀 Démarrage de la synchronisation école';
    const [[demarrageStart, demarrageEnd]] = foldedMatchRanges(line, 'demarrage');
    expect(line.slice(demarrageStart, demarrageEnd)).toBe('Démarrage');
    const [[ecoleStart, ecoleEnd]] = foldedMatchRanges(line, 'ecole');
    expect(line.slice(ecoleStart, ecoleEnd)).toBe('école');
  });

  it('should highlight a word-final sigma the way the whole-line match finds it', () => {
    expect(includesFolded('ΛΟΓΟΣ', 'λογος')).toBe(true);
    expect(foldedMatchRanges('ΛΟΓΟΣ', 'λογος')).toEqual([[0, 5]]);
    expect(foldedMatchRanges('ΛΟΓΟΣ', 'λογοσ')).toEqual([[0, 5]]);
  });

  it('should trim the needle', () => {
    expect(foldedMatchRanges('École', ' ecole ')).toEqual([[0, 5]]);
  });

  it('should return no range for an empty or blank needle', () => {
    expect(foldedMatchRanges('École', '')).toEqual([]);
    expect(foldedMatchRanges('École', '  ')).toEqual([]);
  });

  it('should return no range when nothing matches', () => {
    expect(foldedMatchRanges('École', 'zèbre')).toEqual([]);
    expect(foldedMatchRanges('', 'a')).toEqual([]);
  });
});

describe('compareText', () => {
  it('should group the variants of a name and sort numbers naturally', () => {
    const names = ['Zèbre', 'abc', 'école', 'eden', 'Ecole', 'Scenario 10', 'Scenario 2'];
    expect(names.toSorted(compareText)).toEqual(['abc', 'Ecole', 'école', 'eden', 'Scenario 2', 'Scenario 10', 'Zèbre']);
  });

  it('should order case and accent variants of one name deterministically', () => {
    expect(compareText('ecole', 'Ecole')).toBe(-1);
    expect(compareText('Ecole', 'école')).toBe(-1);
    expect(compareText('école', 'Ecole')).toBe(1);
  });

  it('should return 0 for equal strings', () => {
    expect(compareText('école', 'école')).toBe(0);
  });

  it('should order Œuvre next to oeuvre', () => {
    expect(['Œuvre', 'oeuvre', 'obus', 'pomme'].toSorted(compareText)).toEqual(['obus', 'oeuvre', 'Œuvre', 'pomme']);
  });
});
