/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { Users } from 'lucide-react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavToolbarMenu } from './nav-toolbar-menu';
import { ScopeSwitcher } from './scope-switcher';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    // Outside a router a link renders as a plain anchor; the active styling is the router's own concern.
    Link: ({ children, activeOptions: _activeOptions, activeProps: _activeProps, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode, activeOptions?: unknown, activeProps?: unknown }) => (
      <a {...props}>{children}</a>
    ),
  };
});

afterEach(() => {
  cleanup();
});

describe('NavToolbarMenu', () => {
  it('draws each entry as a rail row, never as a button', () => {
    render(<NavToolbarMenu entries={[{ linkOption: { href: '/a' }, label: 'Users', icon: <Users /> }]} />);
    const row = screen.getByRole('link', { name: 'Users' });
    expect(row.getAttribute('class')).not.toMatch(/\bbutton\b|font-(bold|semibold|medium)/);
    expect(row.getAttribute('class')).toContain('text-sm');
    expect(row.querySelector('svg')).not.toBeNull();
  });

  it('keeps the whole label reachable when it truncates, and appends the number', () => {
    render(<NavToolbarMenu entries={[{ linkOption: { href: '/a' }, label: 'Supporting Asset Categories', number: 3 }]} />);
    expect(screen.getByTitle('Supporting Asset Categories').textContent).toBe('Supporting Asset Categories (3)');
  });

  it('sits one elevation layer above the page with a subtle border', () => {
    const { container } = render(<NavToolbarMenu entries={[]} header={<div>scope</div>} />);
    const aside = container.querySelector('aside');
    expect(aside?.getAttribute('class')).toContain('bg-[var(--fds-bg-elevation-default-layer-1)]');
    expect(aside?.getAttribute('class')).toContain('border-elevation-subtle-soft');
    expect(screen.getByText('scope')).toBeTruthy();
  });
});

describe('ScopeSwitcher', () => {
  it('marks the selected scope only, with the tinted toggle', () => {
    render(<ScopeSwitcher scope="platform" tenantLinkOption={{ href: '/t' }} platformLinkOption={{ href: '/p' }} />);
    const platform = screen.getByRole('link', { name: 'Platform' });
    const tenant = screen.getByRole('link', { name: 'This tenant' });
    expect(platform.getAttribute('aria-current')).toBe('page');
    expect(tenant.getAttribute('aria-current')).toBeNull();
    expect(platform.getAttribute('class')).toContain('text-filigran-brand-primary');
    expect(tenant.getAttribute('class')).toContain('text-default-secondary');
    expect(platform.getAttribute('class')).not.toMatch(/\bbutton\b/);
  });
});
