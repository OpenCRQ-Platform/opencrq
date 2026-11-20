import { Link } from '@tanstack/react-router';
import type { FunctionComponent, MouseEventHandler, ReactNode } from 'react';
import { useHasManageSecurity } from '../../../hooks';

interface CrqIndicatorsSettingsLinkProps {
  children: ReactNode,
  onClick?: MouseEventHandler<HTMLAnchorElement>,
}

/** The settings are reserved to MANAGE_SECURITY, so anyone else, or the capability still loading, reads the words without a link. */
export const CrqIndicatorsSettingsLink: FunctionComponent<CrqIndicatorsSettingsLinkProps> = ({ children, onClick }) => {
  const hasManageSecurity = useHasManageSecurity();
  if (!hasManageSecurity) {
    return <span>{children}</span>;
  }
  return (
    <Link from="/$tenantId/{-$organizationId}" to="settings/engine/crq-indicators" className="text-primary hover:underline" onClick={onClick}>
      {children}
    </Link>
  );
};
