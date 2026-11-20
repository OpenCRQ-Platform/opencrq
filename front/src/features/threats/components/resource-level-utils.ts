/** STIX `attack-resource-level-ov` built-ins, weakest first: a level's rank is its index plus one. */
export const RESOURCE_LEVELS = ['individual', 'club', 'contest', 'team', 'organization', 'government'] as const;

export type ResourceLevel = typeof RESOURCE_LEVELS[number];

export const isResourceLevel = (value: string): value is ResourceLevel => (RESOURCE_LEVELS as ReadonlyArray<string>).includes(value);

/** The built-in a stored value names, read case-insensitively; null for a value outside the six. */
export const toResourceLevel = (value: string | null): ResourceLevel | null => {
  const normalized = value?.trim().toLowerCase() ?? '';
  return isResourceLevel(normalized) ? normalized : null;
};

/** From 1 (individual) to 6 (government), null when the value is not one of the six built-ins. */
export const resourceLevelRank = (value: string | null): number | null => {
  const level = toResourceLevel(value);
  return level === null ? null : RESOURCE_LEVELS.indexOf(level) + 1;
};
