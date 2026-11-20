/** Which of the two empty states the relevant-threats panel shows. */
export type RelevantThreatsEmptyState = 'no-matches' | 'no-analyses';

export const resolveRelevantThreatsEmptyState = ({
  itemCount,
  hasAnyAnalyses,
}: {
  itemCount: number,
  hasAnyAnalyses: boolean,
}): RelevantThreatsEmptyState | null => {
  if (itemCount > 0) {
    return null;
  }
  return hasAnyAnalyses ? 'no-matches' : 'no-analyses';
};
