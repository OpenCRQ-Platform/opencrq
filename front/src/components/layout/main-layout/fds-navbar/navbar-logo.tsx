import { Icon, useNavbarCollapsed } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Link, linkOptions } from '@tanstack/react-router';
import { useThemeLogo } from '../../../../hooks';
import { useOptionalTenant } from '../../../../providers';
import { cn } from '../../../../utils';

/**
 * Inside a tenant the logo opens that tenant's home: `/` only redirects to the first tenant, so
 * sending a reader there would take them through a tenant-less route and, with several tenants,
 * to another tenant than the one on screen. Outside a tenant (the platform surface) it keeps `/`.
 */
export const navbarLogoLink = (tenantId: string | undefined) => (tenantId
  ? linkOptions({ to: '/$tenantId/{-$organizationId}', params: { tenantId, organizationId: undefined } })
  : linkOptions({ to: '/' }));

/**
 * Brand row of the navbar header band, sized on the design system's own
 * `ProductSwitcher` slots: a 126x28 box for the wordmark, a 28x28 square for
 * the collapsed rail. The collapsed state uses the design system's `opencrq`
 * glyph rather than a crop of the wordmark, which no square crop can centre.
 */
export const NavbarLogo = () => {
  const logo = useThemeLogo();
  const collapsed = useNavbarCollapsed();
  const tenant = useOptionalTenant();

  return (
    <Link
      {...navbarLogoLink(tenant?.tenantId)}
      aria-label={t`OpenCRQ home`}
      className={cn(
        'inline-flex h-7 shrink-0 items-center overflow-hidden',
        collapsed ? 'w-7 justify-center' : 'w-[126px]',
      )}
    >
      {collapsed ? (
        <Icon name="custom/opencrq" size={24} aria-hidden />
      ) : (
        <img
          src={logo}
          alt={t`OpenCRQ`}
          className="w-[126px]"
        />
      )}
    </Link>
  );
};
