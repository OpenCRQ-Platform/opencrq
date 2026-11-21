import { Icon, ProductSwitcher } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import logoOpenAevDark from '/logo-openaev-dark.svg';
import logoOpenAevLight from '/logo-openaev-light.svg';
import logoOpenCtiDark from '/logo-opencti-dark.svg';
import logoOpenCtiLight from '/logo-opencti-light.svg';
import logoXtmHubDark from '/logo-xtm-hub-dark.svg';
import logoXtmHubLight from '/logo-xtm-hub-light.svg';
import { useThemeLogo } from '../../../../hooks';
import { useTRPC } from '../../../../lib';
import { useOptionalTenant, useTheme } from '../../../../providers';
import { navbarLogoPath, productSwitcherDestinations } from './navbar-logo-utils';

const productLogo = (src: string) => (
  <img src={src} alt="" style={{ width: '100%', height: 'auto', objectFit: 'contain' }} />
);

/**
 * Brand row of the navbar header band: the design system's `ProductSwitcher`, as OpenCTI and
 * OpenAEV render it. The wordmark is the home link, the chevron opens the other XTM Platform
 * products; the collapsed rail shows the `opencrq` glyph, the home link alone.
 */
export const NavbarLogo = () => {
  const trpc = useTRPC();
  const logo = useThemeLogo();
  const { effectiveTheme } = useTheme();
  const tenant = useOptionalTenant();
  const { data: connectorsStatus } = useQuery({ ...trpc.integrations.getConnectorsStatus.queryOptions(), enabled: tenant !== undefined });
  const dark = effectiveTheme === 'dark';
  const destinations = productSwitcherDestinations({
    openctiUrl: connectorsStatus?.opencti?.url ?? null,
    openaevUrl: connectorsStatus?.openaev?.url ?? null,
  });

  return (
    <ProductSwitcher
      label={t`Filigran products`}
      logo={(
        <img
          src={logo}
          alt=""
          style={{ height: 28, width: '100%', objectFit: 'contain', objectPosition: 'left center' }}
        />
      )}
      logoCollapsed={<Icon name="custom/opencrq" size={24} aria-hidden />}
      logoTo={navbarLogoPath(tenant?.tenantId)}
      logoLabel={t`OpenCRQ home`}
      linkComponent={Link}
      options={[
        {
          id: 'opencti',
          // eslint-disable-next-line lingui/no-unlocalized-strings -- product name, not copy
          label: 'OpenCTI',
          logo: productLogo(dark ? logoOpenCtiDark : logoOpenCtiLight),
          tooltip: destinations.opencti.connected ? t`Platform connected` : t`Get OpenCTI now`,
          href: destinations.opencti.href,
        },
        {
          id: 'openaev',
          // eslint-disable-next-line lingui/no-unlocalized-strings -- product name, not copy
          label: 'OpenAEV',
          logo: productLogo(dark ? logoOpenAevDark : logoOpenAevLight),
          tooltip: destinations.openaev.connected ? t`Platform connected` : t`Get OpenAEV now`,
          href: destinations.openaev.href,
        },
        {
          id: 'xtm-hub',
          // eslint-disable-next-line lingui/no-unlocalized-strings -- product name, not copy
          label: 'XTM Hub',
          logo: productLogo(dark ? logoXtmHubDark : logoXtmHubLight),
          tooltip: t`Get XTM Hub now`,
          href: destinations.xtmHub.href,
        },
      ]}
    />
  );
};
