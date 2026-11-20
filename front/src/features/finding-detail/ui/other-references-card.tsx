import { Plural } from '@lingui/react/macro';
import { ChevronRight } from 'lucide-react';
import type { FunctionComponent } from 'react';
import type { RemediationReference } from '../remediation-utils';
import { ReferenceLink } from './reference-link';

/**
 * On the Remediation tab, everything the record points at that says nothing about a fix.
 *
 * Collapsed by default, and the collapse is load-bearing rather than tidy: one CVE routinely
 * publishes dozens of mailing-list posts around a handful of vendor pages, and listing them flat
 * buries the pages that answer the question the tab exists for.
 */
export const OtherReferencesCard: FunctionComponent<{ references: Array<RemediationReference> }> = ({ references }) => {
  if (references.length === 0) {
    return null;
  }

  return (
    <details className="group flex flex-col gap-2">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 font-content-compact text-content-compact text-default-secondary">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
        <Plural value={references.length} one="# other reference" other="# other references" />
      </summary>
      <ul className="mt-3 flex flex-col">
        {references.map((reference) => (
          <li
            key={reference.url}
            className="border-b py-3 last:border-b-0"
            style={{ borderColor: 'var(--fds-border-elevation-subtle-soft)' }}
          >
            <ReferenceLink reference={reference} />
          </li>
        ))}
      </ul>
    </details>
  );
};
