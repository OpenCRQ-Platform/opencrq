import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Plural, Trans } from '@lingui/react/macro';
import { ExternalLink } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { daysSince, formatDate } from '../../../utils';
import { kevCatalogUrl, splitRequiredAction } from '../remediation-utils';

interface KevRequiredActionBannerProps {
  cveId: string,
  listedAt: Date | string | null,
  requiredAction: string | null,
  dueDate: Date | string | null,
  ransomwareUse: string | null,
}

/**
 * What CISA published on a KEV-listed flaw.
 *
 * The deadline is stated as CISA's own, because the directive behind it binds US federal civilian
 * agencies and nobody else: calling it overdue would assert a breach a tenant outside that
 * perimeter cannot commit, on every KEV entry, since the catalogue allows two to three weeks and
 * almost every date is long past.
 *
 * The required action is quoted, never classified. The catalogue cycles through dozens of wordings,
 * from a plain patch order to a demand to disconnect an unsupported product, and a gesture word
 * derived from them would send an unrecognised wording to whichever bucket happened to be the
 * default.
 *
 * Renders nothing when the catalogue stated no action, which is what a CVE outside KEV looks like.
 */
export const KevRequiredActionBanner: FunctionComponent<KevRequiredActionBannerProps> = ({
  cveId,
  listedAt,
  requiredAction,
  dueDate,
  ransomwareUse,
}) => {
  if (requiredAction === null && dueDate === null) {
    return null;
  }

  const daysPastDue = daysSince(dueDate) ?? 0;
  const listedLabel = listedAt === null ? '' : formatDate(listedAt);
  const dueLabel = dueDate === null ? '' : formatDate(dueDate);

  return (
    <div
      className="flex flex-col gap-3 rounded-[var(--fds-radius-sm)] px-5 py-4"
      style={{ background: 'var(--fds-color-feedback-error-secondary-transparency-30)' }}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span
          className="font-content-title-xs text-content-title-xs uppercase tracking-[var(--fds-tracking-relaxed)]"
          style={{ color: 'var(--fds-color-feedback-error-primary)' }}
        >
          <Trans>Known exploited · CISA KEV catalog</Trans>
        </span>
        <span className="ml-auto flex flex-wrap gap-x-1.5 font-content-compact text-content-compact text-default-secondary">
          {listedAt !== null && <span><Trans>listed {listedLabel}</Trans></span>}
          {dueDate !== null && (
            <span>
              {daysPastDue > 0
                ? <Trans>CISA deadline {dueLabel}, <Plural value={daysPastDue} one="# day ago" other="# days ago" /></Trans>
                : <Trans>CISA deadline {dueLabel}</Trans>}
            </span>
          )}
        </span>
      </div>

      {requiredAction !== null && (
        <blockquote
          className="flex flex-col gap-1 border-l-2 pl-3"
          style={{ borderColor: 'var(--fds-color-feedback-error-primary)' }}
        >
          <span className="font-content-caption text-content-caption uppercase tracking-[var(--fds-tracking-relaxed)] text-default-secondary">
            <Trans>Action CISA requires</Trans>
          </span>
          <p className="max-w-[70ch] font-content-base text-content-base">
            {splitRequiredAction(requiredAction).map((segment, index) => (
              segment.kind === 'text'
                ? <span key={`${index}-${segment.value}`}>{segment.value}</span>
                : (
                  <a
                    key={`${index}-${segment.value}`}
                    href={segment.value}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="break-all text-primary underline-offset-4 hover:underline"
                  >
                    {segment.value}
                  </a>
                )
            ))}
          </p>
        </blockquote>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {ransomwareUse !== null && (
          ransomwareUse.toLowerCase() === 'known'
            ? <Chip severity="critical" label={t`Ransomware campaign use: known`} />
            : <Chip severity="neutral" label={t`Ransomware campaign use: unknown`} />
        )}
        <a
          href={kevCatalogUrl(cveId)}
          target="_blank"
          rel="noreferrer noopener"
          className="flex w-fit items-center gap-1.5 font-content-compact text-content-compact text-primary underline-offset-4 hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          <Trans>Read the entry in the CISA KEV catalog</Trans>
        </a>
      </div>
    </div>
  );
};
