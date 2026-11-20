import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import type { ComponentFix } from '../remediation-utils';
import { ComponentFixCard } from './component-fix-card';
import { SectionLabel } from './section-label';

interface VendorPublishedSectionProps {
  components: Array<ComponentFix>,
  /** Prose no component claimed, quoted as the vendor wrote it since nothing parsed a version out. */
  unassignedLines: Array<string>,
}

/**
 * What the feeds state about fixing this flaw, one card per affected component.
 *
 * The section is never titled with an update verb: a KEV entry whose product is out of support has
 * no update to name, and the product derives no gesture of its own from the catalogue's wording.
 */
export const VendorPublishedSection: FunctionComponent<VendorPublishedSectionProps> = ({
  components,
  unassignedLines,
}) => (
  <div className="flex flex-col gap-2">
    <SectionLabel>{t`What the vendor published`}</SectionLabel>
    {components.length === 0 && unassignedLines.length === 0 ? (
      <div
        className="rounded-[var(--fds-radius-sm)] border border-dashed p-6 font-content-base text-content-base text-default-secondary"
        style={{ borderColor: 'var(--fds-border-elevation-subtle)' }}
      >
        <Trans>No version range has been published for this CVE.</Trans>
      </div>
    ) : (
      <div className="flex flex-col gap-4">
        {components.map((fix) => <ComponentFixCard key={fix.key} fix={fix} />)}
        {unassignedLines.length > 0 && (
          <div
            className="flex flex-col gap-2 rounded-[var(--fds-radius-sm)] border p-4"
            style={{ borderColor: 'var(--fds-border-elevation-subtle)' }}
          >
            <span className="font-content-caption text-content-caption text-default-secondary">
              <Trans>Stated by the vendor, naming no component this CVE lists</Trans>
            </span>
            {unassignedLines.map((line) => (
              <p key={line} className="font-content-base text-content-base">{line}</p>
            ))}
          </div>
        )}
      </div>
    )}
  </div>
);
