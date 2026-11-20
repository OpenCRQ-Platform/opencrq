// Letters Unicode does not decompose, mirroring Postgres' unaccent.rules so the client and
// the `fold_text` SQL function agree on what a user can type.
const UNDECOMPOSED_LETTERS: Readonly<Record<string, string>> = {
  œ: 'oe',
  Œ: 'oe',
  æ: 'ae',
  Æ: 'ae',
  ß: 'ss',
  ẞ: 'ss',
  ø: 'o',
  Ø: 'o',
  ł: 'l',
  Ł: 'l',
  đ: 'd',
  Đ: 'd',
  ð: 'd',
  Ð: 'd',
  þ: 'th',
  Þ: 'th',
  ı: 'i',
  // Lower-casing a whole string turns a word-final `Σ` into `ς` but a lone `Σ` into `σ`: one letter for
  // both keeps `foldedMatchRanges`, which folds character by character, in step with `includesFolded`.
  ς: 'σ',
};

const COMBINING_MARKS = /[\u0300-\u036f]/g;
const UNDECOMPOSED_PATTERN = new RegExp(`[${Object.keys(UNDECOMPOSED_LETTERS).join('')}]`, 'g');

/** Lower-cased, accent-free form of `value` for matching. Never trims. */
export const foldText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(UNDECOMPOSED_PATTERN, (letter) => UNDECOMPOSED_LETTERS[letter] ?? letter);

const foldNeedle = (needle: string): string => foldText(needle).trim();

/** `needle` folded and trimmed; an empty needle matches everything; a nullish haystack matches only an empty needle. */
export const includesFolded = (haystack: string | null | undefined, needle: string): boolean => {
  const folded = foldNeedle(needle);
  if (folded === '') {
    return true;
  }
  return haystack != null && foldText(haystack).includes(folded);
};

/**
 * Ranges `[start, end)` in the original `haystack` of every non-overlapping folded match of `needle`,
 * left to right. A range covers whole original characters, so a match on half of `ß` returns all of it.
 */
export const foldedMatchRanges = (haystack: string, needle: string): Array<[number, number]> => {
  const folded = foldNeedle(needle);
  if (folded === '') {
    return [];
  }

  // Folding changes lengths, so each folded character remembers the original span it came from.
  let foldedHaystack = '';
  const starts: Array<number> = [];
  const ends: Array<number> = [];
  let offset = 0;
  for (const character of haystack) {
    const end = offset + character.length;
    const foldedCharacter = foldText(character);
    if (foldedCharacter === '' && ends.length > 0) {
      ends[ends.length - 1] = end;
    }
    // `split('')` yields UTF-16 units, one entry per unit as `indexOf` counts them.
    for (const unit of foldedCharacter.split('')) {
      foldedHaystack += unit;
      starts.push(offset);
      ends.push(end);
    }
    offset = end;
  }

  const ranges: Array<[number, number]> = [];
  let lastEnd = 0;
  let from = 0;
  for (let index = foldedHaystack.indexOf(folded, from); index !== -1; index = foldedHaystack.indexOf(folded, from)) {
    const start = starts[index];
    const end = ends[index + folded.length - 1];
    if (start >= lastEnd) {
      ranges.push([start, end]);
      lastEnd = end;
      from = index + folded.length;
    } else {
      from = index + 1;
    }
  }
  return ranges;
};

const textCollator = new Intl.Collator('en', { numeric: true });

/** Human-text order: accents and case grouped, `Scenario 2` before `Scenario 10`, whatever the browser's language. */
export const compareText = (first: string, second: string): number => textCollator.compare(first, second);
