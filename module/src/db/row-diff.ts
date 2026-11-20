/**
 * What to delete and insert so a set of held rows becomes the wanted set, without touching a row
 * both share. The key is the row's whole tuple of values, so a row whose value changes is one
 * deletion plus one insertion. Of a duplicated held row the first is kept, and a duplicated wanted
 * row is inserted once.
 */
export const diffRows = <Held, Wanted>(
  held: ReadonlyArray<Held>,
  wanted: ReadonlyArray<Wanted>,
  keyOfHeld: (row: Held) => string,
  keyOfWanted: (row: Wanted) => string,
): { stale: Array<Held>, missing: Array<Wanted> } => {
  const wantedKeys = new Set(wanted.map(keyOfWanted));
  const keptKeys = new Set<string>();
  const stale: Array<Held> = [];
  for (const row of held) {
    const key = keyOfHeld(row);
    if (wantedKeys.has(key) && !keptKeys.has(key)) {
      keptKeys.add(key);
    } else {
      stale.push(row);
    }
  }
  const missing: Array<Wanted> = [];
  for (const row of wanted) {
    const key = keyOfWanted(row);
    if (!keptKeys.has(key)) {
      keptKeys.add(key);
      missing.push(row);
    }
  }
  return { stale, missing };
};
