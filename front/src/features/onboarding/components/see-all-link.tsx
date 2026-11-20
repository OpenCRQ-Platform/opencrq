import { Link } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';

type SeeAllLinkTo =
  | '/$tenantId/{-$organizationId}/assets'
  | '/$tenantId/{-$organizationId}/threat-center'
  | '/$tenantId/{-$organizationId}/controls'
  | '/$tenantId/{-$organizationId}/primary-assets'
  | '/$tenantId/{-$organizationId}/risk-scenarios'
  | '/$tenantId/{-$organizationId}/details/overview';

interface SeeAllLinkProps {
  to: SeeAllLinkTo,
  label: string,
  /** The risk scope the page opens on; left out, the page is the tenant-wide one. */
  organizationId?: string,
}

/** A plain in-app link, same tab, to the app page that lists what a step creates; the dashboard's "See all" links look the same. */
export const SeeAllLink: FunctionComponent<SeeAllLinkProps> = ({ to, label, organizationId }) => (
  <Link
    to={to}
    params={(prev) => ({ ...prev, tenantId: prev.tenantId!, organizationId })}
    className="font-content-compact text-content-compact text-filigran-brand-primary hover:underline focus-visible:underline"
  >
    {label}
  </Link>
);
