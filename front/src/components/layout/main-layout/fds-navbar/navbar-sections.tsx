import type { FunctionComponent } from 'react';
import { ScopeSlot } from '../../scope-slot';
import { NavRows } from './nav-items';
import { getPlatformNavigationNodes } from './nav-model';
import { ScopeNavigationSections } from './scope-navigation-sections';

interface NavbarSectionsProps {
  tenantId: string | undefined,
  /** The tenant-less platform surface, whose route already signs out anyone without platform access. */
  onPlatformSurface: boolean,
}

export const NavbarSections: FunctionComponent<NavbarSectionsProps> = ({ tenantId, onPlatformSurface }) => {
  if (tenantId !== undefined) {
    return (
      <>
        <ScopeSlot />
        <ScopeNavigationSections tenantId={tenantId} />
      </>
    );
  }
  return onPlatformSurface ? <NavRows nodes={getPlatformNavigationNodes()} /> : null;
};
