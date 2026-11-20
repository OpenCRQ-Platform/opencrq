import { t } from '@lingui/core/macro';
import { ASSESSMENT_AXES } from '@app/module/client';
import type { AssessmentAxis, AssessmentMode } from '@app/module/client';
import type { CapabilityEvent } from '../types/capability';
import { coverageLabel } from '../ui/coverage-label';
import { strengthLabel } from '../ui/strength-label';

export type EventSentenceFields = Pick<
  CapabilityEvent,
  | 'organizationId' | 'userId' | 'connector' | 'type'
  | 'oldStrength' | 'newStrength' | 'oldCoverage' | 'newCoverage'
  | 'strengthMode' | 'coverageMode'
>;

/** Null when the axis did not move. A null value reads "Not assessed" before the event, "derived" after it. */
const axisMove = (event: EventSentenceFields, axis: AssessmentAxis): string | null => {
  const derived = t({ context: 'assessment value', message: 'derived' });
  const notAssessed = t`Not assessed`;
  switch (axis) {
    case 'strength': {
      if (event.oldStrength === event.newStrength) {
        return null;
      }
      const from = event.oldStrength === null ? notAssessed : strengthLabel(event.oldStrength);
      const to = event.newStrength === null ? derived : strengthLabel(event.newStrength);
      return t`${from} → ${to}`;
    }
    case 'coverage': {
      if (event.oldCoverage === event.newCoverage) {
        return null;
      }
      const from = event.oldCoverage === null ? notAssessed : coverageLabel(event.oldCoverage);
      const to = event.newCoverage === null ? derived : coverageLabel(event.newCoverage);
      return t`${from} → ${to}`;
    }
  }
};

const oneAxisSwitchSentence = (axis: AssessmentAxis, toAuto: boolean, move: string | null): string => {
  if (move === null) {
    switch (axis) {
      case 'strength':
        return toAuto ? t`Strength re-attached to its sources.` : t`Strength detached from its sources.`;
      case 'coverage':
        return toAuto ? t`Coverage re-attached to its sources.` : t`Coverage detached from its sources.`;
    }
  }
  switch (axis) {
    case 'strength':
      return toAuto ? t`Strength re-attached to its sources (${move}).` : t`Strength detached from its sources (${move}).`;
    case 'coverage':
      return toAuto ? t`Coverage re-attached to its sources (${move}).` : t`Coverage detached from its sources (${move}).`;
  }
};

/**
 * Null when the event switched no axis's mode. One event switches its axes in a single direction:
 * a declaration only detaches, a re-attach only re-attaches.
 */
const modeSwitchSentence = (event: EventSentenceFields, withValues: boolean): string | null => {
  const modeOf: Record<AssessmentAxis, AssessmentMode | null> = {
    strength: event.strengthMode,
    coverage: event.coverageMode,
  };
  const switched = ASSESSMENT_AXES.filter((axis) => modeOf[axis] !== null);
  const [only] = switched;
  if (only === undefined) {
    return null;
  }
  const toAuto = modeOf[only] === 'auto';
  if (switched.length === 1) {
    return oneAxisSwitchSentence(only, toAuto, withValues ? axisMove(event, only) : null);
  }
  return toAuto ? t`Strength and coverage re-attached to their sources.` : t`Strength and coverage detached from their sources.`;
};

const scopeEventSentence = (event: EventSentenceFields, withValues: boolean): string => {
  if (event.oldStrength !== event.newStrength && event.oldCoverage !== event.newCoverage) {
    return t`Strength and coverage updated.`;
  }
  if (event.oldStrength !== event.newStrength) {
    if (event.newStrength === null) {
      return t`Strength returned to the tenant value.`;
    }
    if (!withValues) {
      return event.oldStrength === null ? t`Strength overridden.` : t`Strength changed.`;
    }
    const to = strengthLabel(event.newStrength);
    if (event.oldStrength === null) {
      return t`Strength overridden to ${to}.`;
    }
    const from = strengthLabel(event.oldStrength);
    return t`Strength changed from ${from} to ${to}.`;
  }
  if (event.newCoverage === null) {
    return t`Coverage returned to the tenant value.`;
  }
  if (!withValues) {
    return event.oldCoverage === null ? t`Coverage overridden.` : t`Coverage changed.`;
  }
  const to = coverageLabel(event.newCoverage);
  if (event.oldCoverage === null) {
    return t`Coverage overridden to ${to}.`;
  }
  const from = coverageLabel(event.oldCoverage);
  return t`Coverage changed from ${from} to ${to}.`;
};

const sentenceOf = (event: EventSentenceFields, withValues: boolean): string => {
  if (event.organizationId !== null) {
    return scopeEventSentence(event, withValues);
  }
  const modeSwitch = modeSwitchSentence(event, withValues);
  if (modeSwitch !== null) {
    return modeSwitch;
  }
  if (event.type === 'strength_change') {
    if (!withValues) {
      return t`Strength changed.`;
    }
    const from = strengthLabel(event.oldStrength ?? 'L0');
    const to = strengthLabel(event.newStrength ?? 'L0');
    return t`Strength changed from ${from} to ${to}.`;
  }
  if (event.type === 'coverage_change') {
    if (!withValues) {
      return t`Coverage changed.`;
    }
    const from = coverageLabel(event.oldCoverage ?? 'L0');
    const to = coverageLabel(event.newCoverage ?? 'L0');
    return t`Coverage changed from ${from} to ${to}.`;
  }
  if (event.type === 'assessment_change') {
    return t`Strength and coverage updated.`;
  }
  if (event.type === 'sources_changed') {
    if (event.connector === null) {
      return t`Declared by hand at the value it held.`;
    }
    return event.userId === null
      ? t`Derivation sources updated.`
      : t`Re-attached to its sources.`;
  }
  if (event.type === 'assessment_cleared') {
    if (event.newStrength === null && event.newCoverage === null) {
      return t`Assessment cleared: no source feeds it any more.`;
    }
    return event.newStrength === null
      ? t`Strength cleared: no source feeds it any more.`
      : t`Coverage cleared: no source feeds it any more.`;
  }
  return t`Assessment created.`;
};

/** The sentence an event of the assessment journal reads as, on the lifeline and as the title of its detail. */
export const capabilityEventSentence = (event: EventSentenceFields): string => sentenceOf(event, true);

/** The same sentence without the values, for a line that shows each axis's move beside it. */
export const capabilityEventHeadline = (event: EventSentenceFields): string => sentenceOf(event, false);
