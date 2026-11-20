import { includesFolded } from '@app/utils/text-fold';
import type { AnswerState, FrameworkNodeKind, MaturityLevel, MaturitySummary } from '@app/module/client';
import { MATURITY_LEVELS, summariseMaturity } from '@app/module/client';
import type { ChipSeverity } from '@filigran/design-system';
import type { ComplianceAnswerFormValues } from './components/compliance-answer-schema';

export interface AssessmentNode {
  id: string,
  parentId: string | null,
  code: string,
  title: string,
  kind: FrameworkNodeKind,
  isRequirement: boolean,
  position: number,
}

export interface AssessmentTreeNode<N extends AssessmentNode = AssessmentNode> {
  node: N,
  children: Array<AssessmentTreeNode<N>>,
  /** Every requirement at or below this node, in document order. */
  requirementIds: Array<string>,
  maturity: MaturitySummary,
}

export const buildAssessmentTree = <N extends AssessmentNode>(
  nodes: ReadonlyArray<N>,
  answers: ReadonlyMap<string, AnswerState>,
): Array<AssessmentTreeNode<N>> => {
  const childrenOf = new Map<string | null, Array<N>>();
  for (const node of [...nodes].sort((a, b) => a.position - b.position)) {
    const siblings = childrenOf.get(node.parentId) ?? [];
    siblings.push(node);
    childrenOf.set(node.parentId, siblings);
  }
  const build = (node: N): AssessmentTreeNode<N> => {
    const children = (childrenOf.get(node.id) ?? []).map(build);
    const requirementIds = node.isRequirement ? [node.id] : children.flatMap((child) => child.requirementIds);
    return { node, children, requirementIds, maturity: summariseMaturity(requirementIds, answers) };
  };
  return (childrenOf.get(null) ?? []).map(build);
};

/** Owner, due date and comment alone are not an answer. */
export const isAnswered = (answer: AnswerState | undefined): boolean =>
  answer !== undefined && (answer.notApplicable || answer.level !== null);

export interface TreeFilter {
  search: string,
  unansweredOnly: boolean,
  /** When set, only these requirements are kept: the ones that feed a control. */
  feedingControls?: ReadonlySet<string> | null,
}

/**
 * Keeps the requirements the filter matches and the sections leading to them; a section matching
 * the search keeps its whole subtree. Returns the tree as is when nothing filters.
 */
export const filterAssessmentTree = <N extends AssessmentNode>(
  tree: ReadonlyArray<AssessmentTreeNode<N>>,
  answers: ReadonlyMap<string, AnswerState>,
  { search, unansweredOnly, feedingControls = null }: TreeFilter,
): Array<AssessmentTreeNode<N>> => {
  const noSearch = search.trim() === '';
  if (noSearch && !unansweredOnly && feedingControls === null) {
    return [...tree];
  }
  const matchesText = (node: N) => includesFolded(node.code, search)
    || includesFolded(node.title, search);
  const keep = (entry: AssessmentTreeNode<N>, ancestorMatched: boolean): AssessmentTreeNode<N> | null => {
    const textMatched = ancestorMatched || matchesText(entry.node);
    if (entry.node.isRequirement) {
      const passesAnswer = !unansweredOnly || !isAnswered(answers.get(entry.node.id));
      const passesControls = feedingControls === null || feedingControls.has(entry.node.id);
      return textMatched && passesAnswer && passesControls ? entry : null;
    }
    const children = entry.children
      .map((child) => keep(child, textMatched))
      .filter((child): child is AssessmentTreeNode<N> => child !== null);
    return children.length === 0 ? null : { ...entry, children };
  };
  return tree
    .map((entry) => keep(entry, false))
    .filter((entry): entry is AssessmentTreeNode<N> => entry !== null);
};

export interface ControlLink {
  requirementId: string,
  capabilityId: string,
}

export const linksByRequirement = <L extends ControlLink>(links: ReadonlyArray<L>): ReadonlyMap<string, ReadonlyArray<L>> =>
  Map.groupBy(links, (link) => link.requirementId);

/**
 * The distinct controls reached by the requirements answered on a level, over every control the
 * framework reaches. A not applicable answer feeds nothing.
 */
export const fedControlCount = (
  links: ReadonlyArray<ControlLink>,
  answers: ReadonlyMap<string, AnswerState>,
): { fed: number, reached: number } => ({
  fed: new Set(links.filter((link) => (answers.get(link.requirementId)?.level ?? null) !== null).map((link) => link.capabilityId)).size,
  reached: new Set(links.map((link) => link.capabilityId)).size,
});

export const filterAssessments = <A extends { name: string, frameworkTitle: string }>(
  assessments: ReadonlyArray<A>,
  search: string,
): Array<A> =>
  assessments.filter((assessment) => includesFolded(assessment.name, search)
      || includesFolded(assessment.frameworkTitle, search));

export const ASSESSMENT_SOURCES = ['opencrq', 'drata'] as const;
export type AssessmentSource = typeof ASSESSMENT_SOURCES[number];

interface NativeAssessmentInput {
  id: string,
  name: string,
  frameworkTitle: string,
  updatedAt: string,
}

interface DrataFrameworkInput {
  id: string,
  name: string,
  lastReportedAt: Date | string,
}

export type AssessmentListRow<A extends NativeAssessmentInput, F extends DrataFrameworkInput> =
  | { source: 'opencrq', id: string, name: string, frameworkTitle: string, updatedAt: string, assessment: A }
  | { source: 'drata', id: string, name: string, frameworkTitle: string, updatedAt: string, framework: F };

export const toAssessmentListRows = <A extends NativeAssessmentInput, F extends DrataFrameworkInput>(
  assessments: ReadonlyArray<A>,
  frameworks: ReadonlyArray<F>,
): Array<AssessmentListRow<A, F>> => [
  ...assessments.map((assessment): AssessmentListRow<A, F> => ({
    source: 'opencrq',
    id: assessment.id,
    name: assessment.name,
    frameworkTitle: assessment.frameworkTitle,
    updatedAt: assessment.updatedAt,
    assessment,
  })),
  ...frameworks.map((framework): AssessmentListRow<A, F> => ({
    source: 'drata',
    id: framework.id,
    name: framework.name,
    frameworkTitle: framework.name,
    updatedAt: new Date(framework.lastReportedAt).toISOString(),
    framework,
  })),
];

export const filterBySource = <R extends { source: AssessmentSource }>(rows: ReadonlyArray<R>, source: AssessmentSource | 'all'): Array<R> =>
  (source === 'all' ? [...rows] : rows.filter((row) => row.source === source));

export const latestUpdatedFirst = <R extends { updatedAt: string }>(rows: ReadonlyArray<R>): Array<R> =>
  [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const sectionIds =(tree: ReadonlyArray<AssessmentTreeNode>): Array<string> =>
  tree.flatMap((entry) => (entry.node.isRequirement ? [] : [entry.node.id, ...sectionIds(entry.children)]));

export const completedCount = (maturity: MaturitySummary): number => maturity.answeredCount + maturity.notApplicableCount;

export const completionPercent = (maturity: MaturitySummary): number =>
  (maturity.requirementCount === 0 ? 0 : Math.round((completedCount(maturity) / maturity.requirementCount) * 100));

export const toMaturityLevel = (level: number | null): MaturityLevel | null =>
  MATURITY_LEVELS.find((candidate) => candidate === level) ?? null;

export const MATURITY_SCALE_MAX = MATURITY_LEVELS[MATURITY_LEVELS.length - 1];

export const maturitySeverity = (level: number): Extract<ChipSeverity, 'high' | 'medium' | 'low' | 'info'> => {
  if (level < 1.5) {
    return 'high';
  }
  if (level < 2.5) {
    return 'medium';
  }
  if (level < 3.5) {
    return 'low';
  }
  return 'info';
};

export type AnswerDraft = ComplianceAnswerFormValues;

/** Level and not applicable are one field, the rating, since an answer cannot carry both. */
export type AnswerDraftField = Exclude<keyof AnswerDraft, 'level' | 'notApplicable'> | 'rating';

// A record, so a field added to the form schema fails to compile until it is listed here.
const ANSWER_DRAFT_FIELD_SET: Record<AnswerDraftField, true> = { ownerId: true, dueDate: true, rating: true, comment: true };
const isAnswerDraftField = (key: string): key is AnswerDraftField => key in ANSWER_DRAFT_FIELD_SET;
const ANSWER_DRAFT_FIELDS = Object.keys(ANSWER_DRAFT_FIELD_SET).filter(isAnswerDraftField);

export const answerFieldDiffers = (field: AnswerDraftField, a: AnswerDraft, b: AnswerDraft): boolean =>
  (field === 'rating' ? a.level !== b.level || a.notApplicable !== b.notApplicable : a[field] !== b[field]);

/**
 * Lays the fields a draft changed from the answer it was loaded from onto the answer stored since:
 * an untouched field takes the stored value.
 */
export const rebaseAnswerDraft = (base: AnswerDraft, draft: AnswerDraft, stored: AnswerDraft): AnswerDraft => {
  const ratingTouched = answerFieldDiffers('rating', draft, base);
  return {
    ownerId: draft.ownerId === base.ownerId ? stored.ownerId : draft.ownerId,
    dueDate: draft.dueDate === base.dueDate ? stored.dueDate : draft.dueDate,
    level: ratingTouched ? draft.level : stored.level,
    notApplicable: ratingTouched ? draft.notApplicable : stored.notApplicable,
    comment: draft.comment === base.comment ? stored.comment : draft.comment,
  };
};

/**
 * The fields `rebaseAnswerDraft` keeps from the draft although the stored answer changed them too,
 * to another value. A field listed in `previous` stays while the draft still differs from the stored
 * value, so a second conflict does not drop one the user has not settled.
 */
export const conflictingAnswerFields = (
  base: AnswerDraft,
  draft: AnswerDraft,
  stored: AnswerDraft,
  previous: ReadonlyArray<AnswerDraftField>,
): Array<AnswerDraftField> => ANSWER_DRAFT_FIELDS.filter((field) => answerFieldDiffers(field, draft, stored)
  && (previous.includes(field) || (answerFieldDiffers(field, draft, base) && answerFieldDiffers(field, stored, base))));
