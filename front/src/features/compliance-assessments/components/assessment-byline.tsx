import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { ComplianceAssessment } from './compliance-assessment-types';
import { ActorName } from '../../../components/shared';
import { formatDate, resolveActor } from '../../../utils';

type AssessmentBylineFields = Pick<
  ComplianceAssessment,
  'frameworkTitle' | 'createdAt' | 'createdBy' | 'createdByServiceAccount' | 'publishedAt' | 'publishedBy' | 'publishedByServiceAccount'
>;

const personName = (person: ComplianceAssessment['createdBy']) => person?.name ?? person?.email ?? null;

export const AssessmentByline: FunctionComponent<{ assessment: AssessmentBylineFields }> = ({ assessment }) => {
  const framework = assessment.frameworkTitle;
  const openedOn = formatDate(assessment.createdAt);
  const openedByActor = resolveActor(personName(assessment.createdBy), assessment.createdByServiceAccount);
  const openedBy = openedByActor === null ? null : <ActorName actor={openedByActor} />;
  const publishedOn = assessment.publishedAt === null ? null : formatDate(assessment.publishedAt);
  const publishedByActor = resolveActor(personName(assessment.publishedBy), assessment.publishedByServiceAccount);
  const publishedBy = publishedByActor === null ? null : <ActorName actor={publishedByActor} />;
  return (
    <p className="txt-sub-content text-default-secondary">
      {openedBy === null
        ? <Trans>Framework {framework} · opened on {openedOn}</Trans>
        : <Trans>Framework {framework} · opened on {openedOn} by {openedBy}</Trans>}
      {publishedOn !== null && (
        <>
          {' · '}
          {publishedBy === null
            ? <Trans>published on {publishedOn}</Trans>
            : <Trans>published on {publishedOn} by {publishedBy}</Trans>}
        </>
      )}
    </p>
  );
};
