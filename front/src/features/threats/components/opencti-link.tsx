import { ExternalLink } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';

interface OpenCtiLinkProps {
  href: string | null,
  /** Accessible name, and the visible text unless `iconOnly`. */
  label: string,
  /** Row affordance: icon only, with the label carried through `aria-label`/`title` instead of visible text. */
  iconOnly?: boolean,
  /** Overrides the default classes so the link matches the typography already used where it is placed. */
  className?: string,
}

// eslint-disable-next-line lingui/no-unlocalized-strings -- Tailwind class list, not copy
const ICON_ONLY_CLASS = 'flex items-center text-primary hover:underline';
// eslint-disable-next-line lingui/no-unlocalized-strings -- Tailwind class list, not copy
const FULL_CLASS = 'flex items-center gap-1.5 font-content-compact text-content-compact text-primary underline-offset-4 hover:underline';

/**
 * Deep link to a STIX object or relationship on the tenant's OpenCTI platform. Renders nothing
 * when `href` is null — the caller resolves the link (base URL + connector-stated id) and this
 * component only ever renders what it is given.
 */
export const OpenCtiLink: FunctionComponent<OpenCtiLinkProps> = ({ href, label, iconOnly, className }): ReactElement | null => {
  if (href === null) {
    return null;
  }

  if (iconOnly) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={label}
        title={label}
        className={className ?? ICON_ONLY_CLASS}
      >
        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={label}
      className={className ?? FULL_CLASS}
    >
      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
      {label}
    </a>
  );
};
