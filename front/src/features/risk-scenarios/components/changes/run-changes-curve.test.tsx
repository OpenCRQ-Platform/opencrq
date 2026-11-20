/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurvePoint, CurveRange } from './run-changes-utils';
import { formatDateMinute } from '../../../../utils';
import { RunChangesCurve } from './run-changes-curve';
import { createMarkerStore } from './run-changes-marker-store';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const KEY_COMMIT_DELAY_MS = 400;

const points: Array<CurvePoint> = [10, 20, 30, 40].map((value, index) => ({
  runId: `run-${index}`,
  at: new Date(2026, 5, 1, 9, index * 7),
  value,
}));

const renderCurve = (range: CurveRange = [0, 3]) => {
  const navigations: Array<() => void> = [];
  const onRangeChange = vi.fn((_next: CurveRange) => new Promise<void>((resolve) => {
    navigations.push(resolve);
  }));
  const markerStore = createMarkerStore();
  const curve = (shown: CurveRange) => (
    <I18nProvider i18n={i18n}>
      <RunChangesCurve
        points={points}
        range={shown}
        onRangeChange={onRangeChange}
        formatValue={(value) => `v${value}`}
        formatChange={(before, after) => `${before}>${after}`}
        ariaLabel="Curve"
        markerStore={markerStore}
        collapse={0}
        zoom={0}
      />
    </I18nProvider>
  );
  const { rerender } = render(curve(range));
  const later = screen.getByRole('slider', { name: 'Later run' });
  return {
    onRangeChange,
    earlier: screen.getByRole('slider', { name: 'Earlier run' }),
    later,
    plot: screen.getByRole('img', { name: 'Curve' }),
    routeTo: (next: CurveRange) => rerender(curve(next)),
    settle: async () => {
      await act(async () => {
        navigations.forEach((resolve) => resolve());
        await Promise.all(onRangeChange.mock.results.map((result) => result.value));
      });
    },
  };
};

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe('RunChangesCurve keyboard', () => {
  it('should follow the draft while keys are pressed and commit once they pause', () => {
    const { onRangeChange, later } = renderCurve();

    fireEvent.keyDown(later, { key: 'ArrowLeft' });
    fireEvent.keyDown(later, { key: 'ArrowLeft' });

    expect(onRangeChange).not.toHaveBeenCalled();
    expect(later.getAttribute('aria-valuenow')).toBe('1');
    expect(later.getAttribute('aria-valuetext')).toBe(`Run of ${formatDateMinute(points[1].at)}, v20`);

    advance(KEY_COMMIT_DELAY_MS);

    expect(onRangeChange).toHaveBeenCalledTimes(1);
    expect(onRangeChange).toHaveBeenCalledWith([0, 1]);
  });

  it('should commit the draft at once on blur, and not again after the delay', () => {
    const { onRangeChange, later } = renderCurve();

    fireEvent.keyDown(later, { key: 'ArrowLeft' });
    fireEvent.keyDown(later, { key: 'ArrowLeft' });
    fireEvent.blur(later);

    expect(onRangeChange).toHaveBeenCalledTimes(1);
    expect(onRangeChange).toHaveBeenCalledWith([0, 1]);

    advance(KEY_COMMIT_DELAY_MS);

    expect(onRangeChange).toHaveBeenCalledTimes(1);
  });

  it('should not commit when the keys bring the range back to the committed one', () => {
    const { onRangeChange, later } = renderCurve();

    fireEvent.keyDown(later, { key: 'ArrowLeft' });
    fireEvent.keyDown(later, { key: 'ArrowRight' });

    expect(later.getAttribute('aria-valuenow')).toBe('3');

    advance(KEY_COMMIT_DELAY_MS);

    expect(onRangeChange).not.toHaveBeenCalled();
  });

  it('should stop the earlier end one run before the later end', () => {
    const { onRangeChange, earlier } = renderCurve();

    for (let step = 0; step < 5; step += 1) {
      fireEvent.keyDown(earlier, { key: 'ArrowRight' });
    }

    expect(earlier.getAttribute('aria-valuenow')).toBe('2');
    expect(onRangeChange).not.toHaveBeenCalled();

    advance(KEY_COMMIT_DELAY_MS);

    expect(onRangeChange).toHaveBeenCalledTimes(1);
    expect(onRangeChange).toHaveBeenCalledWith([2, 3]);
  });

  it('should keep the committed run on the handle until the navigation settles', async () => {
    const { onRangeChange, later, routeTo, settle } = renderCurve();

    fireEvent.keyDown(later, { key: 'ArrowLeft' });
    fireEvent.keyDown(later, { key: 'ArrowLeft' });
    advance(KEY_COMMIT_DELAY_MS);

    expect(onRangeChange).toHaveBeenCalledWith([0, 1]);
    expect(later.getAttribute('aria-valuenow')).toBe('1');

    routeTo([0, 1]);
    await settle();

    expect(later.getAttribute('aria-valuenow')).toBe('1');
  });

  it('should come back to the range when another navigation overtook the committed one', async () => {
    const { onRangeChange, later, routeTo, settle } = renderCurve();

    fireEvent.keyDown(later, { key: 'ArrowLeft' });
    fireEvent.blur(later);

    expect(onRangeChange).toHaveBeenCalledWith([0, 2]);
    expect(later.getAttribute('aria-valuenow')).toBe('2');

    routeTo([0, 3]);

    expect(later.getAttribute('aria-valuenow')).toBe('2');

    await settle();

    expect(later.getAttribute('aria-valuenow')).toBe('3');
  });

  it('should not commit again when the keys come back to the run just committed', () => {
    const { onRangeChange, later } = renderCurve();

    fireEvent.keyDown(later, { key: 'ArrowLeft' });
    advance(KEY_COMMIT_DELAY_MS);
    fireEvent.keyDown(later, { key: 'ArrowLeft' });
    fireEvent.keyDown(later, { key: 'ArrowRight' });
    advance(KEY_COMMIT_DELAY_MS);

    expect(onRangeChange).toHaveBeenCalledTimes(1);
    expect(onRangeChange).toHaveBeenCalledWith([0, 2]);
  });
});

describe('RunChangesCurve pointer', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 300, height: 100 }));
    // jsdom has no pointer capture.
    HTMLElement.prototype.setPointerCapture = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
  });

  it('should start a click from the range the keys committed, before the range comes back', () => {
    const { onRangeChange, later, plot } = renderCurve();

    fireEvent.keyDown(later, { key: 'ArrowLeft' });
    fireEvent.pointerDown(plot, { pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(plot, { pointerId: 1, clientX: 100 });

    expect(onRangeChange.mock.calls).toEqual([[[0, 2]], [[1, 2]]]);
    expect(later.getAttribute('aria-valuenow')).toBe('2');
  });
});
