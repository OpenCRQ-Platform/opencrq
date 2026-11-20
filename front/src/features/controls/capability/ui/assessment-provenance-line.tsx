import type { FunctionComponent } from 'react';
import { Trans } from '@lingui/react/macro';
import type { CapabilityAssessedBy } from '../types/capability';
import { formatRelativeTime } from '../../../../utils';
import { joinSourceNames } from '../utils/assessment-axes-utils';

interface AssessmentProvenanceLineProps {
  at: string | Date | null,
  by: CapabilityAssessedBy | null,
  /** The sources of a derived value; null when a user declared it. */
  derivedFrom: ReadonlyArray<string> | null,
}

export const AssessmentProvenanceLine: FunctionComponent<AssessmentProvenanceLineProps> = ({ at, by, derivedFrom }) => {
  if (at === null) {
    return null;
  }
  const when = formatRelativeTime(at);
  if (derivedFrom !== null) {
    const author = by?.name ?? null;
    if (derivedFrom.length === 0) {
      return (
        <p className="txt-sub-content text-muted-foreground">
          {author === null ? <Trans>Derived {when}</Trans> : <Trans>Adopted {when} by {author}</Trans>}
        </p>
      );
    }
    const connectorName = joinSourceNames(derivedFrom);
    return (
      <p className="txt-sub-content text-muted-foreground">
        {author === null
          ? <Trans>Derived from {connectorName} {when}</Trans>
          : <Trans>Adopted from {connectorName} {when} by {author}</Trans>}
      </p>
    );
  }
  if (by === null) {
    return (
      <p className="txt-sub-content text-muted-foreground">
        <Trans>Declared {when} by a deleted user</Trans>
      </p>
    );
  }
  if (by.name === null) {
    return (
      <p className="txt-sub-content text-muted-foreground">
        <Trans>Declared {when}</Trans>
      </p>
    );
  }
  const author = by.name;
  return (
    <p className="txt-sub-content text-muted-foreground">
      <Trans>Declared {when} by {author}</Trans>
    </p>
  );
};
