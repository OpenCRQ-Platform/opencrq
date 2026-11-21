/** @vitest-environment jsdom */
import { Icon } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NavToolbarMenu } from './nav-toolbar-menu';
import { ScopeSwitcher } from './scope-switcher';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

// The rail and the scope switch read the router's active state, so they render inside a real router
// sitting on `initialEntry`; `/a`, `/b` and `/security` are its pages.
const renderInRouter = (ui: ReactNode, initialEntry = '/a') => {
  const rootRoute = createRootRoute({ component: () => <I18nProvider i18n={i18n}><Outlet />{ui}</I18nProvider> });
  const pages = ['/a', '/b', '/security'].map((path) => createRoute({ getParentRoute: () => rootRoute, path, component: () => null }));
  const router = createRouter({
    routeTree: rootRoute.addChildren(pages),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  return render(<RouterProvider router={router} />);
};

const iconSlotOf = (link: HTMLElement): HTMLElement | null => link.querySelector('span[aria-hidden]');

describe('NavToolbarMenu', () => {
  it('draws each entry as a rail row, never as a button', async () => {
    renderInRouter(<NavToolbarMenu entries={[{ linkOption: { href: '/b' }, label: 'Users', icon: <Icon name="user" size={16} /> }]} />);
    const row = await screen.findByRole('link', { name: 'Users' });
    expect(row.getAttribute('class')).not.toMatch(/\bbutton\b|font-(bold|semibold|medium)/);
    expect(row.getAttribute('class')).toContain('text-sm');
    expect(row.querySelector('svg')).not.toBeNull();
  });

  it('washes a hovered row with the hover token of the layer the rail sits on', async () => {
    renderInRouter(<NavToolbarMenu entries={[{ linkOption: { href: '/b' }, label: 'Groups' }]} />);
    const row = await screen.findByRole('link', { name: 'Groups' });
    expect(row.getAttribute('class')).toContain('hover:bg-[var(--fds-bg-elevation-hover-layer-1)]');
    expect(row.getAttribute('class')).not.toMatch(/hover:bg-elevation-hover\b/);
  });

  it('draws the selected row icon at full opacity in the primary ink, the others at half opacity', async () => {
    renderInRouter(
      <NavToolbarMenu
        entries={[
          { linkOption: { href: '/a' }, label: 'Users', icon: <Icon name="user" size={16} /> },
          { linkOption: { href: '/b' }, label: 'Groups', icon: <Icon name="users" size={16} /> },
        ]}
      />,
      '/a',
    );
    const selected = await screen.findByRole('link', { name: 'Users' });
    const other = screen.getByRole('link', { name: 'Groups' });
    expect(selected.getAttribute('aria-current')).toBe('page');
    expect(iconSlotOf(selected)?.getAttribute('class')).toMatch(/\bopacity-100\b/);
    expect(iconSlotOf(selected)?.getAttribute('class')).toMatch(/\btext-default-primary\b/);
    expect(iconSlotOf(other)?.getAttribute('class')).toMatch(/\bopacity-50\b/);
    expect(iconSlotOf(other)?.getAttribute('class')).toMatch(/\btext-default-secondary\b/);
  });

  it('keeps the whole label reachable when it truncates, and appends the number', async () => {
    renderInRouter(<NavToolbarMenu entries={[{ linkOption: { href: '/b' }, label: 'Supporting Asset Categories', number: 3 }]} />);
    expect((await screen.findByTitle('Supporting Asset Categories')).textContent).toBe('Supporting Asset Categories (3)');
  });

  it('sits one elevation layer above the page with a subtle border', async () => {
    const { container } = renderInRouter(<NavToolbarMenu entries={[]} header={<div>scope</div>} />);
    expect(await screen.findByText('scope')).toBeTruthy();
    const aside = container.querySelector('aside');
    expect(aside?.getAttribute('class')).toContain('bg-[var(--fds-bg-elevation-default-layer-1)]');
    expect(aside?.getAttribute('class')).toContain('border-elevation-subtle-soft');
  });
});

describe('ScopeSwitcher', () => {
  // Both scopes share the path: the router marks both links active, the switch must not.
  it.each(['tenant', 'platform'] as const)('marks only the selected scope as the current page (%s)', async (scope) => {
    renderInRouter(
      <ScopeSwitcher scope={scope} tenantLinkOption={{ href: '/security' }} platformLinkOption={{ href: '/security?scope=platform' }} />,
      scope === 'platform' ? '/security?scope=platform' : '/security',
    );
    const platform = await screen.findByRole('link', { name: 'Platform' });
    const tenant = screen.getByRole('link', { name: 'This tenant' });
    const [selected, other] = scope === 'platform' ? [platform, tenant] : [tenant, platform];
    expect(selected.getAttribute('aria-current')).toBe('page');
    expect(other.getAttribute('aria-current')).toBeNull();
    expect(other.getAttribute('data-status')).toBeNull();
    expect(selected.getAttribute('class')).toContain('text-filigran-brand-primary');
    expect(other.getAttribute('class')).toContain('text-default-secondary');
    expect(selected.getAttribute('class')).not.toMatch(/\bbutton\b/);
  });
});
