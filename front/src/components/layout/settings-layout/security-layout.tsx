import { Outlet } from '@tanstack/react-router';
import type { FunctionComponent, ReactNode } from 'react';
import type { MenuEntry } from './nav-toolbar-menu';
import { NavToolbarMenu } from './nav-toolbar-menu';

export interface SecurityLayoutProps {
  entries: Array<MenuEntry>,
  header?: ReactNode,
}

export const SecurityLayout: FunctionComponent<SecurityLayoutProps> = ({ entries, header }) => (
  <div className="mr-[200px]">
    <Outlet />
    <NavToolbarMenu entries={entries} header={header} />
  </div>
);
