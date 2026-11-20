/**
 * Shared Filigran TELEMETRY__USAGE__TAGS normalization contract (same behavior as
 * OpenCTI, OpenAEV and XTM One): split on commas, trim, lowercase, drop
 * empties, dedupe, sort. The normalized tags are exported as the
 * `filigran.telemetry.tags` resource attribute so the analytics warehouse can
 * slice any metric by deployment dimension (e.g. "saas,eu-west").
 */
export const normalizeTelemetryTags = (raw: string | null | undefined): Array<string> => {
  if (!raw) {
    return [];
  }
  const tags = new Set<string>();
  for (const part of raw.split(',')) {
    const tag = part.trim().toLowerCase();
    if (tag) {
      tags.add(tag);
    }
  }
  return [...tags].sort();
};
