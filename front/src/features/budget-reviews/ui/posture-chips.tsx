import type { FunctionComponent } from 'react';
import type { ControlPosture } from '../budget-review-utils';
import { CoverageBadge } from '../../controls/capability/ui/coverage-badge';
import { StrengthBadge } from '../../controls/capability/ui/strength-badge';

export const PostureChips: FunctionComponent<{ posture: ControlPosture }> = ({ posture }) => (
  <span className="inline-flex items-center gap-1.5">
    <StrengthBadge value={posture.strengthRung} />
    <CoverageBadge value={posture.coverageBucket} />
  </span>
);

/** A control's posture at the start and at the end of the period, never an amount: figures exist per line only. */
export const PostureMove: FunctionComponent<{ start: ControlPosture, end: ControlPosture }> = ({ start, end }) => (
  <span className="inline-flex flex-wrap items-center gap-1.5">
    <PostureChips posture={start} />
    <span aria-hidden="true" className="txt-sub-content text-default-secondary">&rarr;</span>
    <PostureChips posture={end} />
  </span>
);
