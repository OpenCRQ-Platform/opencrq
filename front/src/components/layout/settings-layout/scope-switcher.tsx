import { Icon } from '@filigran/design-system';
import type { IconName } from '@filigran/design-system';
import { createLink } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import type { AnchorHTMLAttributes, ComponentProps, FunctionComponent, Ref } from 'react';
import type { SecurityScope } from './security-scope-utils';
import { cn } from '../../../utils';

type ScopeAnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & { ref?: Ref<HTMLAnchorElement>, selected?: boolean, 'data-status'?: string };

/** A scope target: the Security pages are addressed by a plain `href` (see the Security layout route). */
export interface ScopeLinkOption {
  href?: string,
}

/**
 * The two scope links share their path (only `?scope=platform` tells them apart), so the router marks
 * both active. The anchor drops the router's `aria-current` and `data-status` and renders them from the
 * selected scope alone, so assistive technologies announce one current page.
 */
const ScopeAnchor: FunctionComponent<ScopeAnchorProps> = ({ selected, 'aria-current': _routerCurrent, 'data-status': _routerStatus, ...props }) => (
  <a {...props} aria-current={selected ? 'page' : undefined} data-status={selected ? 'active' : undefined} />
);

const ScopeLink = createLink(ScopeAnchor);

// `Link`'s props require a literal `to`; the scope targets are plain `href`s (see the Security layout
// route), so the option is widened to the link's props, as nav-model.tsx does for scoped links.
const scopeLinkProps = (option: ScopeLinkOption): ComponentProps<typeof ScopeLink> => option as ComponentProps<typeof ScopeLink>;

interface ScopeToggleProps {
  active: boolean,
  linkOption: ScopeLinkOption,
  icon: IconName,
  label: string,
}

/**
 * One half of the scope switch, drawn with the computed values of the OpenAEV `SecurityMenu` toggle: an
 * icon over an 11px semibold label (line height 1.2, normal letter spacing, never wrapped) in a tile
 * padded 14px by 12px with a 1px neutral border, selected or not. The selected tile only tints its
 * background with the brand primary (16%, 22% on hover) and carries the primary ink; the other one
 * stays neutral and takes a 15% primary wash on hover, as OpenAEV's toggle override does. The design
 * system draws icons at 16, 20 or 24px only: 20px stands for OpenAEV's 18px (fds-migration/LIBRARY-FEEDBACK.md).
 */
const ScopeToggle: FunctionComponent<ScopeToggleProps> = ({ active, linkOption, icon, label }) => (
  <ScopeLink
    {...scopeLinkProps(linkOption)}
    selected={active}
    className={cn(
      'flex min-w-0 flex-1 flex-col items-center justify-center gap-1.5 rounded-[var(--fds-radius-sm)] border border-elevation-subtle-soft px-3 py-3.5',
      'text-center text-[11px] font-semibold leading-[1.2] tracking-[normal] whitespace-nowrap transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 ring-focus',
      active
        ? 'bg-[color-mix(in_srgb,var(--fds-color-filigran-brand-primary)_16%,transparent)] text-filigran-brand-primary hover:bg-[color-mix(in_srgb,var(--fds-color-filigran-brand-primary)_22%,transparent)]'
        : 'text-default-secondary hover:bg-[color-mix(in_srgb,var(--fds-color-filigran-brand-primary)_15%,transparent)]',
    )}
  >
    <Icon name={icon} size={20} aria-hidden />
    <span className="tracking-[normal]">{label}</span>
  </ScopeLink>
);

export interface ScopeSwitcherProps {
  scope: SecurityScope,
  tenantLinkOption: ScopeLinkOption,
  platformLinkOption: ScopeLinkOption,
}

/**
 * The single context selector on top of the Security rail. The caller renders it only when the
 * reader can open both scopes, and passes the targets that keep the current entity across scopes.
 */
export const ScopeSwitcher: FunctionComponent<ScopeSwitcherProps> = ({ scope, tenantLinkOption, platformLinkOption }) => (
  <div role="group" aria-label={t`Scope`} className="flex gap-2 px-3 py-2">
    <ScopeToggle key={tenantLinkOption.href} active={scope === 'tenant'} linkOption={tenantLinkOption} icon="building-2" label={t`This tenant`} />
    <ScopeToggle key={platformLinkOption.href} active={scope === 'platform'} linkOption={platformLinkOption} icon="earth" label={t`Platform`} />
  </div>
);
