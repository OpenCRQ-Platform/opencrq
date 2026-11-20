import { Link } from '@tanstack/react-router';
import { buttonVariants } from '@filigran/design-system';
import { Building2, Globe } from 'lucide-react';
import { t } from '@lingui/core/macro';
import type { ComponentProps, FunctionComponent } from 'react';
import type { SecurityScope } from './security-scope-utils';
import { cn } from '../../../utils';

interface ScopeButtonProps {
  active: boolean,
  linkOption: ComponentProps<typeof Link>,
  icon: FunctionComponent<{ className?: string }>,
  label: string,
}

const ScopeButton: FunctionComponent<ScopeButtonProps> = ({ active, linkOption, icon: Icon, label }) => (
  <Link
    className={cn(
      buttonVariants({ priority: active ? 'primary' : 'secondary', size: 'sm' }),
      'h-auto min-w-0 flex-1 flex-col gap-1.5 whitespace-normal py-2 text-center leading-tight',
    )}
    {...linkOption}
  >
    <Icon className="h-[18px] w-[18px]" />
    <span>{label}</span>
  </Link>
);

export interface ScopeSwitcherProps {
  scope: SecurityScope,
  tenantLinkOption: ComponentProps<typeof Link>,
  platformLinkOption: ComponentProps<typeof Link>,
}

export const ScopeSwitcher: FunctionComponent<ScopeSwitcherProps> = ({ scope, tenantLinkOption, platformLinkOption }) => (
  <div className="flex gap-1.5 border-b p-2 pb-2.5">
    <ScopeButton key={tenantLinkOption.href} active={scope === 'tenant'} linkOption={tenantLinkOption} icon={Building2} label={t`This tenant`} />
    <ScopeButton key={platformLinkOption.href} active={scope === 'platform'} linkOption={platformLinkOption} icon={Globe} label={t`Platform`} />
  </div>
);
