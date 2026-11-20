interface RankableThreat {
  activityScore: number | null,
  combinedRelevance: number,
}

export const MAX_MOST_ACTIVE_THREATS = 6;

/** Only a dated activity can be called active: a threat with an unknown one is left out, however relevant. */
export const rankMostActiveThreats = <T extends RankableThreat>(threats: ReadonlyArray<T>): Array<T> =>
  threats
    .filter((threat): threat is T & { activityScore: number } => threat.activityScore !== null)
    .sort((a, b) => (b.activityScore - a.activityScore) || (b.combinedRelevance - a.combinedRelevance))
    .slice(0, MAX_MOST_ACTIVE_THREATS);
