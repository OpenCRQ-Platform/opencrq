import { Trans } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import type { CapabilityDetail } from '../types/capability';
import { splitFirstSentence } from '../utils/first-sentence';
import { strengthLabel } from './strength-label';

/** What each strength rung demands of one control, for the tooltip beside the strength question. */
export const strengthInfo = (rungs: CapabilityDetail['rungs']): ReactNode => [
  <span key="cumulative"><Trans>Each level includes the ones below it.</Trans></span>,
  ...rungs.map((rung) => {
    const rungName = strengthLabel(rung.rung);
    const { first, rest } = splitFirstSentence(rung.label);
    return (
      <span key={rung.rung} className="flex flex-col gap-0.5">
        <span><strong>{rungName}</strong>{` ${first}`}</span>
        {rest === '' ? null : <span className="txt-sub-content text-default-secondary">{rest}</span>}
      </span>
    );
  }),
];
