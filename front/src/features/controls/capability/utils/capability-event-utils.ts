import { ASSESSMENT_AXES } from '@app/module/client';
import type { AssessmentAxis, AssessmentMode, CoverageBucket, StrengthRung } from '@app/module/client';
import type { CapabilityEvent } from '../types/capability';

export type AxisLevel = StrengthRung | CoverageBucket;

export interface AxisMove {
  axis: AssessmentAxis,
  /** False on a first assessment, which has no value before it. */
  hasBefore: boolean,
  from: AxisLevel | null,
  to: AxisLevel | null,
  /** The mode the move switched the axis to; null when the axis kept its mode. */
  toMode: AssessmentMode | null,
}

type AxisMoveEventFields = Pick<
  CapabilityEvent,
  'organizationId' | 'type' | 'oldStrength' | 'newStrength' | 'oldCoverage' | 'newCoverage' | 'strengthMode' | 'coverageMode'
>;

const levelsOf = (event: AxisMoveEventFields, axis: AssessmentAxis): [AxisLevel | null, AxisLevel | null] => {
  switch (axis) {
    case 'strength':
      return [event.oldStrength, event.newStrength];
    case 'coverage':
      return [event.oldCoverage, event.newCoverage];
  }
};

const switchedModeOf = (event: AxisMoveEventFields, axis: AssessmentAxis): AssessmentMode | null => {
  switch (axis) {
    case 'strength':
      return event.strengthMode;
    case 'coverage':
      return event.coverageMode;
  }
};

/**
 * Each axis the event moved or switched, a switch that kept the value included. A scope line moves an
 * axis whenever its declaration changes, a null side being the tenant's value.
 */
export const eventAxisMoves = (event: AxisMoveEventFields): Array<AxisMove> => ASSESSMENT_AXES.flatMap((axis) => {
  const [from, to] = levelsOf(event, axis);
  const toMode = switchedModeOf(event, axis);
  const move: AxisMove = { axis, hasBefore: true, from, to, toMode };
  if (event.organizationId !== null) {
    return from === to ? [] : [move];
  }
  if (event.type === 'assessment_set') {
    return to === null ? [] : [{ ...move, hasBefore: false }];
  }
  return from !== to || toMode !== null ? [move] : [];
});
