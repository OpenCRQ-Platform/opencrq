import { describe, expect, it, vi } from 'vitest';
import {
  creationMappedAssetIds,
  creationShortfall,
  NO_CREATION_PROGRESS,
  pendingCreationWrites,
  runCreationWrites,
  scopeItemsToFillLater,
} from './risk-scope-wizard-utils';

describe('creationMappedAssetIds', () => {
  const delta = { added: ['a', 'b'], removed: [] };

  it('should map the ticked assets of a closed scope', () => {
    expect(creationMappedAssetIds('closed', delta)).toEqual(['a', 'b']);
  });

  it('should map nothing on the whole estate, even after ticking under the other mode', () => {
    expect(creationMappedAssetIds('open', delta)).toEqual([]);
  });
});

const NOTHING_WANTED = { answers: false, declaredEstate: false, tolerance: false };
const EVERYTHING_WANTED = { answers: true, declaredEstate: true, tolerance: true };
const ALL_SAVED = { scopeCreated: true, answersSaved: true, declaredEstateSaved: true, toleranceSaved: true };

describe('pendingCreationWrites', () => {
  it('should write the scope alone when nothing else was entered', () => {
    expect(pendingCreationWrites(NO_CREATION_PROGRESS, NOTHING_WANTED)).toEqual(['scope']);
  });

  it('should write the scope, then the answers, the declared estate and the tolerance', () => {
    expect(pendingCreationWrites(NO_CREATION_PROGRESS, EVERYTHING_WANTED)).toEqual(['scope', 'answers', 'declaredEstate', 'tolerance']);
  });

  it('should write the declared estate after the scope when it is the only thing entered', () => {
    expect(pendingCreationWrites(NO_CREATION_PROGRESS, { ...NOTHING_WANTED, declaredEstate: true })).toEqual(['scope', 'declaredEstate']);
  });

  it('should retry only the tolerance once everything before it landed', () => {
    expect(pendingCreationWrites({ ...ALL_SAVED, toleranceSaved: false }, EVERYTHING_WANTED)).toEqual(['tolerance']);
  });

  it('should never create the scope twice', () => {
    expect(pendingCreationWrites({ ...ALL_SAVED, answersSaved: false }, EVERYTHING_WANTED)).toEqual(['answers']);
  });
});

describe('runCreationWrites', () => {
  const ok = () => vi.fn(() => Promise.resolve());
  const failing = () => vi.fn(() => Promise.reject(new Error('down')));

  it('should stop at a failed scope write and attempt nothing else', async () => {
    const writers = { scope: failing(), answers: ok(), declaredEstate: ok(), tolerance: ok() };
    const reached = await runCreationWrites(NO_CREATION_PROGRESS, ['scope', 'answers', 'declaredEstate', 'tolerance'], writers);
    expect(reached).toEqual(NO_CREATION_PROGRESS);
    expect(writers.answers).not.toHaveBeenCalled();
    expect(writers.declaredEstate).not.toHaveBeenCalled();
    expect(writers.tolerance).not.toHaveBeenCalled();
  });

  it('should still write the others when the answers fail, and record which ones landed', async () => {
    const writers = { scope: ok(), answers: failing(), declaredEstate: ok(), tolerance: ok() };
    const reached = await runCreationWrites(NO_CREATION_PROGRESS, ['scope', 'answers', 'declaredEstate', 'tolerance'], writers);
    expect(reached).toEqual({ ...ALL_SAVED, answersSaved: false });
  });

  it('should still write the tolerance when the declared estate fails', async () => {
    const writers = { scope: ok(), answers: ok(), declaredEstate: failing(), tolerance: ok() };
    const reached = await runCreationWrites(NO_CREATION_PROGRESS, ['scope', 'declaredEstate', 'tolerance'], writers);
    expect(reached).toEqual({ scopeCreated: true, answersSaved: false, declaredEstateSaved: false, toleranceSaved: true });
    expect(writers.tolerance).toHaveBeenCalledOnce();
  });

  it('should report the scope as created before the follow-ups settle', async () => {
    const onScopeCreated = vi.fn();
    let reportedBeforeAnswers = false;
    const writers = {
      scope: ok(),
      answers: vi.fn(() => {
        reportedBeforeAnswers = onScopeCreated.mock.calls.length === 1;
        return Promise.resolve();
      }),
      declaredEstate: ok(),
      tolerance: ok(),
    };
    await runCreationWrites(NO_CREATION_PROGRESS, ['scope', 'answers'], writers, onScopeCreated);
    expect(reportedBeforeAnswers).toBe(true);
  });

  it('should retry the declared estate alone without creating the scope again', async () => {
    const writers = { scope: ok(), answers: ok(), declaredEstate: ok(), tolerance: ok() };
    const progress = { ...ALL_SAVED, declaredEstateSaved: false };
    const reached = await runCreationWrites(progress, pendingCreationWrites(progress, EVERYTHING_WANTED), writers);
    expect(reached).toEqual(ALL_SAVED);
    expect(writers.scope).not.toHaveBeenCalled();
    expect(writers.answers).not.toHaveBeenCalled();
    expect(writers.tolerance).not.toHaveBeenCalled();
  });
});

describe('creationShortfall', () => {
  it('should report nothing once every wanted write landed', () => {
    expect(creationShortfall(ALL_SAVED, EVERYTHING_WANTED)).toBeNull();
  });

  it('should ignore a write that was never wanted', () => {
    expect(creationShortfall({ ...ALL_SAVED, declaredEstateSaved: false }, { ...EVERYTHING_WANTED, declaredEstate: false })).toBeNull();
  });

  it('should name the financial profile for failed answers or a failed tolerance', () => {
    expect(creationShortfall({ ...ALL_SAVED, toleranceSaved: false }, EVERYTHING_WANTED)).toBe('financial-profile');
    expect(creationShortfall({ ...ALL_SAVED, answersSaved: false }, EVERYTHING_WANTED)).toBe('financial-profile');
  });

  it('should name the declared estate, or both', () => {
    expect(creationShortfall({ ...ALL_SAVED, declaredEstateSaved: false }, EVERYTHING_WANTED)).toBe('declared-estate');
    expect(creationShortfall({ ...ALL_SAVED, declaredEstateSaved: false, toleranceSaved: false }, EVERYTHING_WANTED)).toBe('both');
  });
});

describe('scopeItemsToFillLater', () => {
  const complete = {
    reactionTimeSet: true,
    estateMode: 'open' as const,
    mappedCount: 0,
    unansweredEstateKindCount: 0,
    toleranceSet: true,
    unansweredCount: 0,
  };

  it('should list nothing for a complete scope', () => {
    expect(scopeItemsToFillLater(complete)).toEqual([]);
  });

  it('should list every gap in step order', () => {
    expect(scopeItemsToFillLater({
      reactionTimeSet: false,
      estateMode: 'closed',
      mappedCount: 0,
      unansweredEstateKindCount: 12,
      toleranceSet: false,
      unansweredCount: 19,
    })).toEqual(['reaction-time', 'mapping', 'declared-estate', 'tolerance', 'questionnaire']);
  });

  it('should not count an empty mapping on the whole estate', () => {
    expect(scopeItemsToFillLater({ ...complete, estateMode: 'open', mappedCount: 0 })).toEqual([]);
  });
});
