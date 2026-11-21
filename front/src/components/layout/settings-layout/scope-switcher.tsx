import { Link } from '@tanstack/react-router';
import { Building2, Globe } from 'lucide-react';
import { t } from '@lingui/core/macro';
import type { ComponentProps, FunctionComponent } from 'react';
import type { SecurityScope } from './security-scope-utils';
import { cn } from '../../../utils';

interface ScopeToggleProps {
  active: boolean,
  linkOption: ComponentProps<typeof Link>,
  icon: FunctionComponent<{ className?: string }>,
  label: string,
}

/**
 * One half of the scope switch, drawn as the OpenAEV `SecurityMenu` toggle: an 18px icon over an
 * 11px semibold label in an outlined tile; the selected tile is tinted with the brand primary (16%,
 * 22% on hover) and carries the primary ink, the other one stays neutral.
 */
const ScopeToggle: FunctionComponent<ScopeToggleProps> = ({ active, linkOption, icon: Icon, label }) => (
  <Link
    aria-current={active ? 'page' : undefined}
    className={cn(
      'flex min-w-0 flex-1 flex-col items-center justify-center gap-1.5 rounded-[var(--fds-radius-sm)] border px-3 py-3.5',
      'text-center text-[11px] font-semibold leading-[1.2] transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 ring-focus',
      active
        ? 'border-filigran-brand-primary-transparency-55 bg-[color-mix(in_srgb,var(--fds-color-filigran-brand-primary)_16%,transparent)] text-filigran-brand-primary hover:bg-[color-mix(in_srgb,var(--fds-color-filigran-brand-primary)_22%,transparent)]'
        : 'border-elevation-subtle-soft text-default-secondary hover:bg-elevation-hover',
    )}
    {...linkOption}
  >
    <Icon aria-hidden className="size-[18px] shrink-0" />
    <span>{label}</span>
  </Link>
);

export interface ScopeSwitcherProps {
  scope: SecurityScope,
  tenantLinkOption: ComponentProps<typeof Link>,
  platformLinkOption: ComponentProps<typeof Link>,
}

/**
 * The single context selector on top of the Security rail. The caller renders it only when the
 * reader can open both scopes, and passes the targets that keep the current entity across scopes.
 */
export const ScopeSwitcher: FunctionComponent<ScopeSwitcherProps> = ({ scope, tenantLinkOption, platformLinkOption }) => (
  <div role="group" aria-label={t`Scope`} className="flex gap-2 px-3 py-2">
    <ScopeToggle key={tenantLinkOption.href} active={scope === 'tenant'} linkOption={tenantLinkOption} icon={Building2} label={t`This tenant`} />
    <ScopeToggle key={platformLinkOption.href} active={scope === 'platform'} linkOption={platformLinkOption} icon={Globe} label={t`Platform`} />
  </div>
);
