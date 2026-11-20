import { Icon } from '@filigran/design-system';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent, ReactNode } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { normalizeMitreMarkdown, remarkMitreDescription, resolveMitreLink } from '../mitre-description-utils';

const linkClassName = 'text-primary underline-offset-4 hover:underline';

const MitreLink: FunctionComponent<{ href: string | undefined, children?: ReactNode }> = ({ href, children }) => {
  const target = resolveMitreLink(href ?? '');
  switch (target.kind) {
    case 'technique':
      return (
        <Link
          to="/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId"
          params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', techniqueExternalId: target.externalId })}
          className={linkClassName}
        >
          {children}
        </Link>
      );
    case 'tactic':
      return (
        <Link
          to="/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/tactics/$tacticExternalId"
          params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', tacticExternalId: target.externalId })}
          className={linkClassName}
        >
          {children}
        </Link>
      );
    case 'mitigation':
      return (
        <Link
          to="/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/mitigations/$mitigationExternalId"
          params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', mitigationExternalId: target.externalId })}
          className={linkClassName}
        >
          {children}
        </Link>
      );
    case 'external':
      return (
        <a href={target.href} target="_blank" rel="noopener noreferrer" className={`${linkClassName} inline-flex items-baseline gap-0.5`}>
          {children}
          <Icon name="external-link" size={16} className="shrink-0 self-center" />
        </a>
      );
  }
};

const COMPONENTS: Components = {
  a: ({ href, children }) => <MitreLink href={href}>{children}</MitreLink>,
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1 pl-6">{children}</ol>,
  code: ({ children }) => (
    <code className="rounded-[var(--fds-radius-sm)] bg-[var(--fds-bg-elevation-highlight-layer-1)] px-1 font-content-code text-content-code break-all">
      {children}
    </code>
  ),
  sup: ({ children, title }) => <sup title={title} className="ml-px cursor-help text-default-secondary">{children}</sup>,
};

/** An ATT&CK description laid out as attack.mitre.org shows it: paragraphs, lists, code, links and references. */
export const MitreDescription: FunctionComponent<{ text: string }> = ({ text }) => (
  <div className="flex w-full flex-col gap-3 txt-default">
    <Markdown remarkPlugins={[remarkGfm, remarkMitreDescription]} components={COMPONENTS}>
      {normalizeMitreMarkdown(text)}
    </Markdown>
  </div>
);
