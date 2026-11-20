import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { House } from 'lucide-react';
import type { FunctionComponent } from 'react';

interface HomeDashboardChipsProps {
  isMyHome: boolean,
  isTenantHome: boolean,
}

export const HomeDashboardChips: FunctionComponent<HomeDashboardChipsProps> = ({ isMyHome, isTenantHome }) => (
  <span className="flex items-center gap-1.5">
    {isMyHome && <Chip severity="info" startIcon={<House className="size-3.5" aria-hidden />} label={t`My home`} />}
    {isTenantHome && <Chip label={t`Tenant home`} />}
  </span>
);
