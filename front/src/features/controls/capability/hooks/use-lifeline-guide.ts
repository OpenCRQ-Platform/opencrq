import { useEffect, useState } from 'react';
import type { ActiveUpdate } from '../../../../components/shared';

export interface LifelineGuide {
  /** The date this lifeline's active mark sits on, null whenever another lifeline holds the guide. */
  heldAt: Date | null,
  /** The date another lifeline points at, null when this one holds the guide or none does. */
  guideAt: Date | null,
  /** Null releases the guide only if this lifeline holds it. */
  onActiveChange: (at: Date | null) => void,
}

/**
 * One active mark for a set of lifelines, so a pointer on one plot while another keeps keyboard
 * focus still leaves every plot on the same date. The mark is held by its date, never by its index:
 * a refetch can move the window and shift every index.
 */
export const useLifelineGuide = <S extends string>(): ((source: S) => LifelineGuide) => {
  const [held, setHeld] = useState<{ source: S, at: Date } | null>(null);
  return (source) => ({
    heldAt: held?.source === source ? held.at : null,
    guideAt: held === null || held.source === source ? null : held.at,
    onActiveChange: (at) => setHeld((current) => {
      if (at === null) {
        return current?.source === source ? null : current;
      }
      const unchanged = current?.source === source && current.at.getTime() === at.getTime();
      return unchanged ? current : { source, at };
    }),
  });
};

/**
 * The index of a lifeline's active mark among its current marks, and the handler its plot calls.
 * A held date that no current mark carries releases the guide, so the other lifelines drop it too.
 */
export const useGuidedMark = (
  guide: LifelineGuide,
  marks: ReadonlyArray<{ at: Date }> | undefined,
): { active: number | null, changeActive: (next: ActiveUpdate) => void } => {
  const { heldAt, onActiveChange } = guide;
  const found = heldAt === null || marks === undefined
    ? -1
    : marks.findIndex((mark) => mark.at.getTime() === heldAt.getTime());
  const active = found === -1 ? null : found;
  const lost = heldAt !== null && active === null;

  useEffect(() => {
    if (lost) {
      onActiveChange(null);
    }
  }, [lost, onActiveChange]);

  const changeActive = (next: ActiveUpdate) => {
    const resolved = typeof next === 'function' ? next(active) : next;
    onActiveChange(resolved === null ? null : marks?.at(resolved)?.at ?? null);
  };

  return { active, changeActive };
};
