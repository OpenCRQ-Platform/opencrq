/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavGroup, NavSingle } from './nav-model';
import { NavNodeRow } from './nav-items';

const currentPath = vi.hoisted(() => ({ value: '/' }));
const navbar = vi.hoisted(() => ({ collapsed: false }));

vi.mock('@filigran/design-system', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@filigran/design-system')>();
  return { ...actual, useNavbarCollapsed: () => navbar.collapsed };
});

vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    // Outside a router, the location is the only thing the rows read: a link renders as an anchor.
    Link: ({ children, to, activeOptions: _activeOptions, params: _params, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode, to?: string, activeOptions?: unknown, params?: unknown }) => (
      <a href={to} {...props}>{children}</a>
    ),
    useMatchRoute: () => ({ to, fuzzy }: { to: string, fuzzy?: boolean }) => (
      currentPath.value === to || (fuzzy === true && currentPath.value.startsWith(`${to}/`)) ? {} : false
    ),
  };
});

afterEach(() => {
  cleanup();
  navbar.collapsed = false;
});

// The mocked hooks subscribe to nothing, and the React Compiler memoizes the row on its node: a rerender
// passes a new node object, as the rail's and the router's subscriptions re-render the row in the app.
const rerenderRow = (rerender: (ui: ReactNode) => void, node: NavGroup) => {
  rerender(<NavNodeRow node={{ ...node }} />);
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the rows only spread `link` onto the mocked Link
const settingsGroup = {
  kind: 'group',
  id: 'settings',
  label: 'Settings',
  icon: 'settings',
  entries: [
    { id: 'settings-parameters', label: 'Parameters', link: { to: '/tenant-1/settings/parameters' } },
    { id: 'settings-jobs', label: 'Jobs', link: { to: '/tenant-1/settings/jobs' } },
  ],
} as unknown as NavGroup;

describe('NavNodeRow', () => {
  it('should keep a scope\'s initials out of its row text, which the truncation tooltip reads', () => {
    render(
      <NavNodeRow
        node={{ kind: 'scope', id: 'scope-1', label: 'Acme Bank Europe', initials: 'AE', current: false, entries: [] }}
      />,
    );

    const row = screen.getByRole('button', { name: 'Acme Bank Europe' });

    expect(row.textContent.trim()).toBe('Acme Bank Europe');
    expect(row.querySelector('[data-initials="AE"]')).not.toBeNull();
  });

  it('should open a group reached by a direct link to one of its pages', () => {
    currentPath.value = '/tenant-1/settings/parameters';

    render(<NavNodeRow node={settingsGroup} />);

    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('should open a group on a page nested under one of its entries', () => {
    currentPath.value = '/tenant-1/settings/jobs/runs';

    render(<NavNodeRow node={settingsGroup} />);

    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('should not open a collapsed group\'s flyout by itself on one of its pages', () => {
    currentPath.value = '/tenant-1/settings/parameters';
    navbar.collapsed = true;

    render(<NavNodeRow node={settingsGroup} />);

    // The row asks for a closed group: the design system's own collapsed rail is not mounted here.
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('should leave a group closed on a page outside it', () => {
    currentPath.value = '/tenant-1/dashboards';

    render(<NavNodeRow node={settingsGroup} />);

    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('should close a group opened at mount when the persisted rail turns out collapsed', () => {
    currentPath.value = '/tenant-1/settings/parameters';

    const { rerender } = render(<NavNodeRow node={settingsGroup} />);
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-expanded')).toBe('true');

    navbar.collapsed = true;
    rerenderRow(rerender, settingsGroup);

    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('should open a group when the entry holding the current page arrives after mount', () => {
    currentPath.value = '/tenant-1/settings/jobs/runs';
    const withoutJobs = { ...settingsGroup, entries: settingsGroup.entries.filter((entry) => entry.id !== 'settings-jobs') };

    const { rerender } = render(<NavNodeRow node={withoutJobs} />);
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-expanded')).toBe('false');

    rerender(<NavNodeRow node={settingsGroup} />);

    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('should open a group on a client-side navigation into it', () => {
    currentPath.value = '/tenant-1/dashboards';

    const { rerender } = render(<NavNodeRow node={settingsGroup} />);
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-expanded')).toBe('false');

    currentPath.value = '/tenant-1/settings/parameters';
    rerenderRow(rerender, settingsGroup);

    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-expanded')).toBe('true');
  });

  describe('progress bar', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the row only spreads `link` onto the mocked Link
    const getStarted = {
      kind: 'single',
      id: 'get-started',
      label: 'Get started',
      icon: 'rocket',
      link: { to: '/tenant-1/get-started' },
      progress: { value: 12.5, label: '1 of 8' },
    } as unknown as NavSingle;

    it('should show the progress under the entry when the menu is expanded', () => {
      render(<NavNodeRow node={getStarted} />);

      expect(screen.getByRole('progressbar', { name: 'Get started' }).getAttribute('aria-valuetext')).toBe('1 of 8');
      expect(screen.getByText('1 of 8')).not.toBeNull();
    });

    it('should hide the progress when the menu is collapsed', () => {
      navbar.collapsed = true;

      render(<NavNodeRow node={getStarted} />);

      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(screen.queryByText('1 of 8')).toBeNull();
    });

    it('should show no progress for an entry that declares none', () => {
      render(<NavNodeRow node={{ ...getStarted, progress: undefined }} />);

      expect(screen.queryByRole('progressbar')).toBeNull();
    });
  });
});
