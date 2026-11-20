import { Navbar } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { eq, useLiveQuery } from '@tanstack/react-db';
import { useMatches } from '@tanstack/react-router';
import { useOptionalTenant } from '../../../../providers';
import { isPlatformScope } from '../../../../lib/committed-tenant-utils';
import { menuStatusCollection } from '../../../../stores';
import { MadeByFiligran } from './made-by-filigran';
import { NavbarLogo } from './navbar-logo';
import { NavbarSections } from './navbar-sections';

const menuId = 'main-menu';

export const FdsNavbar = () => {
  const tenant = useOptionalTenant();
  const leafMatch = useMatches().at(-1);

  const { data: menuState } = useLiveQuery({
    query: (q) =>
      q.from({ el: menuStatusCollection })
        .where(({ el }) => eq(el.id, menuId))
        .findOne(),
  });

  const isOpen = menuState ? menuState.open : true;

  const handleCollapsedChange = (collapsed: boolean) => {
    if (menuStatusCollection.has(menuId)) {
      menuStatusCollection.update(menuId, (draft) => {
        draft.open = !collapsed;
      });
    } else {
      menuStatusCollection.insert({ id: menuId, open: !collapsed });
    }
  };

  return (
    <Navbar
      aria-label={t`Main navigation`}
      className="shrink-0"
      collapsed={!isOpen}
      onCollapsedChange={handleCollapsedChange}
      header={<NavbarLogo />}
      footer={<MadeByFiligran />}
    >
      <NavbarSections tenantId={tenant?.tenantId} onPlatformSurface={isPlatformScope(leafMatch?.routeId)} />
    </Navbar>
  );
};
