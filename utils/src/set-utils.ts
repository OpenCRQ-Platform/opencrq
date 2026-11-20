export const diffSets = <T extends string | number>(
  existing: ReadonlyArray<T>,
  incoming: ReadonlyArray<T>,
): { toAdd: Array<T>, toRemove: Array<T> } => {
  const existingSet = new Set(existing);
  const incomingSet = new Set(incoming);
  return {
    toAdd: [...incomingSet].filter((item) => !existingSet.has(item)),
    toRemove: [...existingSet].filter((item) => !incomingSet.has(item)),
  };
};
