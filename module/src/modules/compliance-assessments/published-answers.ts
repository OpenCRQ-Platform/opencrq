export interface PublishedAnswerState {
  assessmentId: string,
  publishedAt: Date,
  requirementId: string,
  level: number | null,
  notApplicable: boolean,
}

/**
 * The answer each requirement feeds the controls with: the one of the most recently published
 * assessment that answered it. A requirement left unanswered there keeps its earlier answer, and one
 * answered not applicable feeds nothing, whatever an earlier assessment said.
 */
export const latestPublishedAnswers = <T extends PublishedAnswerState>(
  answers: ReadonlyArray<T>,
): Map<string, T & { level: number }> => {
  const newestFirst = answers.toSorted((a, b) =>
    b.publishedAt.getTime() - a.publishedAt.getTime() || b.assessmentId.localeCompare(a.assessmentId));
  const settled = new Set<string>();
  const feeding = new Map<string, T & { level: number }>();
  for (const answer of newestFirst) {
    if (settled.has(answer.requirementId) || (answer.level === null && !answer.notApplicable)) {
      continue;
    }
    settled.add(answer.requirementId);
    const { level } = answer;
    if (level !== null) {
      feeding.set(answer.requirementId, { ...answer, level });
    }
  }
  return feeding;
};
