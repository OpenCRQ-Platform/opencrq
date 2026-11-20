import type { EstateMode } from '@app/module/client';
import type { EstateMappingDelta } from './components/estate-assets-picker-utils';

/** A scope created with the whole estate keeps no dormant mapping the review never showed. */
export const creationMappedAssetIds = (estateMode: EstateMode, delta: EstateMappingDelta): Array<string> =>
  (estateMode === 'closed' ? delta.added : []);

export type ScopeCreationWrite = 'scope' | 'answers' | 'declaredEstate' | 'tolerance';

export interface ScopeCreationProgress {
  scopeCreated: boolean,
  answersSaved: boolean,
  declaredEstateSaved: boolean,
  toleranceSaved: boolean,
}

export interface ScopeCreationWanted {
  answers: boolean,
  declaredEstate: boolean,
  tolerance: boolean,
}

export const NO_CREATION_PROGRESS: ScopeCreationProgress = { scopeCreated: false, answersSaved: false, declaredEstateSaved: false, toleranceSaved: false };

/**
 * What a press of Create still has to write, in order: a retry after a failed follow-up skips what
 * already landed, so the scope is never created twice.
 */
export const pendingCreationWrites = (
  progress: ScopeCreationProgress,
  wanted: ScopeCreationWanted,
): Array<ScopeCreationWrite> => [
  ...(progress.scopeCreated ? [] : ['scope' as const]),
  ...(wanted.answers && !progress.answersSaved ? ['answers' as const] : []),
  ...(wanted.declaredEstate && !progress.declaredEstateSaved ? ['declaredEstate' as const] : []),
  ...(wanted.tolerance && !progress.toleranceSaved ? ['tolerance' as const] : []),
];

export interface ScopeCreationWriters {
  scope: () => Promise<unknown>,
  answers: () => Promise<unknown>,
  declaredEstate: () => Promise<unknown>,
  tolerance: () => Promise<unknown>,
}

const succeeds = (write: () => Promise<unknown>): Promise<boolean> => write().then(() => true, () => false);

/**
 * A failed scope write stops the run, since the follow-ups need the scope. A failed follow-up does
 * not stop the others, and each write raises its own error toast. `onScopeCreated` fires as soon as
 * the scope exists, before the follow-ups settle.
 */
export const runCreationWrites = async (
  progress: ScopeCreationProgress,
  writes: ReadonlyArray<ScopeCreationWrite>,
  writers: ScopeCreationWriters,
  onScopeCreated: () => void = () => {},
): Promise<ScopeCreationProgress> => {
  if (writes.includes('scope')) {
    if (!await succeeds(writers.scope)) {
      return progress;
    }
    onScopeCreated();
  }
  const answersSaved = progress.answersSaved || (writes.includes('answers') && await succeeds(writers.answers));
  const declaredEstateSaved = progress.declaredEstateSaved || (writes.includes('declaredEstate') && await succeeds(writers.declaredEstate));
  const toleranceSaved = progress.toleranceSaved || (writes.includes('tolerance') && await succeeds(writers.tolerance));
  return { scopeCreated: true, answersSaved, declaredEstateSaved, toleranceSaved };
};

export type ScopeCreationShortfall = 'financial-profile' | 'declared-estate' | 'both';

/** Which part of a created scope the reader still has to complete from its own tab, or null when nothing is missing. */
export const creationShortfall = (progress: ScopeCreationProgress, wanted: ScopeCreationWanted): ScopeCreationShortfall | null => {
  const missing = pendingCreationWrites(progress, wanted);
  const financialProfile = missing.includes('answers') || missing.includes('tolerance');
  const declaredEstate = missing.includes('declaredEstate');
  if (financialProfile && declaredEstate) {
    return 'both';
  }
  if (declaredEstate) {
    return 'declared-estate';
  }
  return financialProfile ? 'financial-profile' : null;
};

export type ScopeLaterItem = 'reaction-time' | 'mapping' | 'declared-estate' | 'tolerance' | 'questionnaire';

interface ScopeLaterInput {
  reactionTimeSet: boolean,
  estateMode: EstateMode,
  mappedCount: number,
  unansweredEstateKindCount: number,
  toleranceSet: boolean,
  unansweredCount: number,
}

export const scopeItemsToFillLater = ({
  reactionTimeSet,
  estateMode,
  mappedCount,
  unansweredEstateKindCount,
  toleranceSet,
  unansweredCount,
}: ScopeLaterInput): Array<ScopeLaterItem> => [
  ...(reactionTimeSet ? [] : ['reaction-time' as const]),
  ...(estateMode === 'closed' && mappedCount === 0 ? ['mapping' as const] : []),
  ...(unansweredEstateKindCount > 0 ? ['declared-estate' as const] : []),
  ...(toleranceSet ? [] : ['tolerance' as const]),
  ...(unansweredCount > 0 ? ['questionnaire' as const] : []),
];
