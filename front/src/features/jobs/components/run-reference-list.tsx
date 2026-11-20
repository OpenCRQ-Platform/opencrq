import { Link, linkOptions } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import type { ResolvedReference } from '../run-references-utils';
import { ActorName } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';

const SCOPE_ROUTE = '/$tenantId/{-$organizationId}';

/** A stored file has no detail page of its own, so it is named, never linked. */
const ReferenceItem: FunctionComponent<{ reference: ResolvedReference }> = ({ reference }) => {
  const { kind, id, label, nameHidden } = reference;
  switch (kind) {
    case 'riskScenario':
      return <Link {...linkOptions({ from: SCOPE_ROUTE, to: 'risk-scenarios/$riskScenarioId', params: { riskScenarioId: id } })} title={id} className="font-content-code text-content-code underline-offset-2 hover:underline">{label}</Link>;
    case 'serviceAccount':
      return <ActorName actor={{ kind: 'serviceAccount', id, name: nameHidden === true ? null : label }} className="font-content-code text-content-code" />;
    case 'user':
      return <Link {...linkOptions({ from: SCOPE_ROUTE, to: 'settings/security/users/$userId', params: { userId: id } })} title={id} className="font-content-code text-content-code underline-offset-2 hover:underline">{label}</Link>;
    case 'storedFile':
      return <span title={id} className="font-content-code text-content-code">{label}</span>;
  }
};

/** The references a run's payload names, comma-separated; a click on one never also opens the row it sits in. */
export const RunReferenceList: FunctionComponent<{ references: Array<ResolvedReference> }> = ({ references }) => {
  if (references.length === 0) {
    return <EmptyValue />;
  }
  return (
    <span className="flex flex-wrap items-center gap-x-1" onClick={(event) => event.stopPropagation()}>
      {references.map((reference, index) => (
        <span key={`${reference.kind}-${reference.id}`} className="flex items-center gap-1">
          <ReferenceItem reference={reference} />
          {index < references.length - 1 && <span className="text-default-secondary">,</span>}
        </span>
      ))}
    </span>
  );
};
