/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useGuidedMark, useLifelineGuide } from './use-lifeline-guide';

afterEach(() => {
  cleanup();
});

const JANUARY = new Date(Date.UTC(2026, 0, 1));
const MARCH = new Date(Date.UTC(2026, 2, 1));
const JUNE = new Date(Date.UTC(2026, 5, 1));
const JULY = new Date(Date.UTC(2026, 6, 1));

type Source = 'assessment' | 'detect';

describe('useLifelineGuide', () => {
  it('should clear the focused lifeline\'s mark when another lifeline is hovered at another date', () => {
    const { result } = renderHook(() => useLifelineGuide<Source>());

    act(() => result.current('assessment').onActiveChange(MARCH));
    act(() => result.current('detect').onActiveChange(JUNE));

    expect(result.current('assessment')).toMatchObject({ heldAt: null, guideAt: JUNE });
    expect(result.current('detect')).toMatchObject({ heldAt: JUNE, guideAt: null });
  });

  it('should keep the guide when a lifeline that no longer holds it lets go', () => {
    const { result } = renderHook(() => useLifelineGuide<Source>());

    act(() => result.current('assessment').onActiveChange(MARCH));
    act(() => result.current('detect').onActiveChange(JUNE));
    act(() => result.current('assessment').onActiveChange(null));

    expect(result.current('assessment')).toMatchObject({ heldAt: null, guideAt: JUNE });
    expect(result.current('detect')).toMatchObject({ heldAt: JUNE, guideAt: null });
  });

  it('should leave every lifeline without a mark when the holder lets go', () => {
    const { result } = renderHook(() => useLifelineGuide<Source>());

    act(() => result.current('assessment').onActiveChange(MARCH));
    act(() => result.current('detect').onActiveChange(JUNE));
    act(() => result.current('detect').onActiveChange(null));

    expect(result.current('assessment')).toMatchObject({ heldAt: null, guideAt: null });
    expect(result.current('detect')).toMatchObject({ heldAt: null, guideAt: null });
  });
});

describe('useGuidedMark', () => {
  const renderGuidedLifelines = (initialMarks: ReadonlyArray<{ at: Date }>) => renderHook(({ marks }) => {
    const guideFor = useLifelineGuide<Source>();
    const detect = useGuidedMark(guideFor('detect'), marks);
    return { assessment: guideFor('assessment'), detect };
  }, { initialProps: { marks: initialMarks } });

  it('should point at the mark of the held date', () => {
    const { result } = renderGuidedLifelines([{ at: JANUARY }, { at: MARCH }, { at: JUNE }]);

    act(() => result.current.detect.changeActive(1));

    expect(result.current.detect.active).toBe(1);
    expect(result.current.assessment.guideAt).toEqual(MARCH);
  });

  it('should stay on its date when a history refresh shifts the marks', () => {
    const { result, rerender } = renderGuidedLifelines([{ at: JANUARY }, { at: MARCH }, { at: JUNE }]);
    act(() => result.current.detect.changeActive(1));

    rerender({ marks: [{ at: MARCH }, { at: JUNE }, { at: JULY }] });

    expect(result.current.detect.active).toBe(0);
    expect(result.current.assessment.guideAt).toEqual(MARCH);
  });

  it('should release the guide on every lifeline when a history refresh drops the held mark', () => {
    const { result, rerender } = renderGuidedLifelines([{ at: JANUARY }, { at: MARCH }, { at: JUNE }]);
    act(() => result.current.detect.changeActive(0));

    rerender({ marks: [{ at: MARCH }, { at: JUNE }, { at: JULY }] });

    expect(result.current.detect.active).toBeNull();
    expect(result.current.assessment.guideAt).toBeNull();
  });
});
