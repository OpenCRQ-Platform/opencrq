import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import { formatDate } from '../../../utils/date-utils';
import { readActivityWindow } from './activity-utils';
import { OpenCtiLink } from './opencti-link';

export interface ProofClaim {
  stixRelationId: string,
  producerStixId: string | null,
  producerName: string | null,
  isInferred: boolean,
  relConfidence: number | null,
  relCreated: string | null,
  relStartTime: string | null,
  relStopTime: string | null,
  relModified: string | null,
  openctiStixRelationId: string | null,
}

interface ClaimItemProps {
  claim: ProofClaim,
  /** The claim itself, as one authored sentence naming the threat and the value it asserts. */
  statement: ReactNode,
  /** Rendered directly under the statement, e.g. the technique's full name for a MITRE claim. */
  caption?: ReactNode,
  /** The value the engine reads an unstated confidence at, carried on the proof it explains. */
  unstatedConfidence: number,
  /** Resolved by the caller (`ClaimList`), so the OpenCTI base URL is read once per list, not once per row. */
  href: string | null,
}

// A producer that recorded itself under a blank name is still a producer, and the panel says so:
// collapsing it into "no producer recorded" would claim the claim is unattributed, which it is not.
const producerLabel = (producerName: string | null): string | null => {
  if (producerName === null) {
    return null;
  }
  return producerName.trim() === '' ? t`an unnamed producer` : producerName;
};

const recordedSentence = (claim: ProofClaim): string => {
  const producer = producerLabel(claim.producerName);
  const entered = claim.relCreated ? formatDate(claim.relCreated) : null;
  if (producer !== null && entered) {
    return t`Recorded by ${producer} on ${entered}`;
  }
  if (producer !== null) {
    return t`Recorded by ${producer}, with no entry date`;
  }
  if (entered) {
    return t`No producer recorded, entered on ${entered}`;
  }
  return t`No producer recorded`;
};

const confidenceSentence = (claim: ProofClaim, unstatedConfidence: number): string => {
  const confidence = claim.relConfidence;
  return confidence === null
    ? t`Confidence not stated, read as ${unstatedConfidence}`
    : t`Confidence ${confidence}`;
};

const activityWindowSentence = (claim: ProofClaim): string => {
  const reading = readActivityWindow(claim, new Date());
  if (reading.kind === 'unstated') {
    return t`Activity window not given`;
  }
  const opens = reading.opensAt ? formatDate(reading.opensAt) : null;
  if (reading.kind === 'open') {
    return opens ? t`Activity window opens ${opens}, still open` : t`Activity window still open, with no opening date`;
  }
  const closes = formatDate(reading.closesAt);
  return opens ? t`Activity window ${opens} to ${closes}` : t`Activity window closes ${closes}, with no opening date`;
};

/**
 * One claim, read as prose. It is a list item and never a table row: `DataTable` renders
 * fixed-width truncating cells inside a horizontal scroller, and a claim has to be readable to the
 * end without scrolling sideways. Nothing here truncates.
 */
export const ClaimItem: FunctionComponent<ClaimItemProps> = ({ claim, statement, caption, unstatedConfidence, href }): ReactElement => (
  <li className="flex flex-col gap-xs">
    <p className="txt-table">{statement}</p>
    {caption && <p className="txt-sub-content text-muted-foreground">{caption}</p>}
    <div className="txt-body2 flex flex-wrap items-center gap-2 text-muted-foreground">
      <span>{recordedSentence(claim)}</span>
      <span>{confidenceSentence(claim, unstatedConfidence)}</span>
      <span>{activityWindowSentence(claim)}</span>
      {claim.isInferred && <Chip label={t`Inferred by OpenCTI`} />}
      <OpenCtiLink href={href} label={t`Open this relationship in OpenCTI`} iconOnly />
    </div>
  </li>
);
