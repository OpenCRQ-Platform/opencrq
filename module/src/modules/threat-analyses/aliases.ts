/**
 * Case-insensitive dedup, keeping the first spelling of each case variant: the enforcement point for
 * every `(analysis_id, lower(value))` unique index this module declares (aliases, secondary
 * motivations, goals). Trims and drops empties.
 */
export const dedupeCaseInsensitive = (values: Array<string>): Array<string> => {
  const byLowerCase = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0 && !byLowerCase.has(trimmed.toLowerCase())) {
      byLowerCase.set(trimmed.toLowerCase(), trimmed);
    }
  }
  return [...byLowerCase.values()];
};

/**
 * The alias-shaped name for {@link dedupeCaseInsensitive}, kept so every alias producer (STIX
 * parser, platform seed, tests, future connectors) names the rule it is applying rather than a
 * generic string helper.
 */
export const dedupeAliases = (aliases: Array<string>): Array<string> => dedupeCaseInsensitive(aliases);
