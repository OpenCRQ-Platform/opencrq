import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { useTRPC } from '../../../lib';
import { readRemediation } from '../remediation-utils';
import { KevRequiredActionBanner } from './kev-required-action-banner';
import { OtherReferencesCard } from './other-references-card';
import { ReferenceLink } from './reference-link';
import { SectionLabel } from './section-label';
import { VendorPublishedSection } from './vendor-published-section';

interface RemediationSectionProps {
  cveId: string,
}

/**
 * The Remediation tab, in the order it answers: what CISA requires, what to move to per component,
 * the fix pages naming no component, then everything else.
 */
export const RemediationSection: FunctionComponent<RemediationSectionProps> = ({ cveId }) => {
  const trpc = useTRPC();
  const { data: cveInfo } = useQuery(trpc.cve.getInfo.queryOptions({ cveId }));
  const { data: remediation } = useQuery(trpc.cve.getRemediation.queryOptions({ cveId }));

  if (!remediation) {
    return null;
  }

  const { components, unassignedVendorLines, leads, rest } = readRemediation({
    affectedVersions: remediation.affectedVersions,
    references: remediation.references,
    kevNotes: cveInfo?.kevNotes,
    vendorSolution: cveInfo?.vendorSolution,
  });

  return (
    <div className="flex flex-col gap-6">
      <KevRequiredActionBanner
        cveId={cveId}
        listedAt={cveInfo?.kevUpdatedAt ?? null}
        requiredAction={cveInfo?.kevRequiredAction ?? null}
        dueDate={cveInfo?.kevDueDate ?? null}
        ransomwareUse={cveInfo?.kevRansomwareUse ?? null}
      />

      <VendorPublishedSection components={components} unassignedLines={unassignedVendorLines} />

      {leads.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionLabel>{t`Other fix leads`}</SectionLabel>
          {leads.map((reference) => <ReferenceLink key={reference.url} reference={reference} />)}
        </div>
      )}

      <OtherReferencesCard references={rest} />
    </div>
  );
};
