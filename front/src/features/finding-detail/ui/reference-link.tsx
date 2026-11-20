import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { ExternalLink } from 'lucide-react';
import type { FunctionComponent } from 'react';
import type { RemediationReference } from '../remediation-utils';
import { referenceLabel } from '../remediation-utils';

/**
 * One external reference, labelled by its host and path.
 *
 * No feed publishes a reference title, so the URL is the label and the tags carry the meaning. A
 * reference with no tag is an unanalysed record, never one judged uninteresting, which is why the
 * absence of a tag row says nothing.
 */
export const ReferenceLink: FunctionComponent<{ reference: RemediationReference }> = ({ reference }) => (
  <a
    href={reference.url}
    target="_blank"
    rel="noreferrer noopener"
    title={reference.url}
    className="flex min-w-0 flex-col gap-1"
  >
    <span className="flex min-w-0 items-center gap-1.5 font-content-base text-content-base text-primary underline-offset-4 hover:underline">
      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{referenceLabel(reference.url)}</span>
    </span>
    {(reference.fromCisa || (reference.tags ?? []).length > 0) && (
      <span className="flex flex-wrap items-center gap-2 pl-5">
        {(reference.tags ?? []).map((tag) => (
          <Chip key={tag} severity="neutral" label={tag} />
        ))}
        {reference.fromCisa && <Chip severity="critical" label={t`Published by CISA`} />}
      </span>
    )}
  </a>
);
