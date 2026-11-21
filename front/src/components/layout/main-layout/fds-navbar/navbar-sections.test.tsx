/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NavbarSections } from './navbar-sections';

vi.mock('@filigran/design-system', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@filigran/design-system')>();
  return { ...actual, useNavbarCollapsed: () => false };
});

vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    // Outside a router, a link renders as an anchor, and the page is the one the platform surface lands on.
    Link: ({ children, to, activeOptions: _activeOptions, params: _params, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode, to?: string, activeOptions?: unknown, params?: unknown }) => (
      <a href={to} {...props}>{children}</a>
    ),
    useMatchRoute: () => ({ to, fuzzy }: { to: string, fuzzy?: boolean }) => (
      fuzzy === true && '/platform/security/users'.startsWith(`${to}/`) ? {} : false
    ),
  };
});

// The tenant bar queries the server; only which bar renders is under test here.
vi.mock('./scope-navigation-sections', () => ({
  ScopeNavigationSections: ({ tenantId }: { tenantId: string }) => <p>{`tenant bar of ${tenantId}`}</p>,
}));

// The tenant switcher reads the reader's tenants from the server, out of scope here.
vi.mock('../../scope-slot', () => ({
  ScopeSlot: () => null,
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

describe('NavbarSections', () => {
  it('renders the tenant bar whenever a tenant is selected', () => {
    render(<NavbarSections tenantId="acme" onPlatformSurface={false} />);

    expect(screen.getByText('tenant bar of acme')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Security' })).toBeNull();
  });

  it('gives the tenant-less platform surface Settings > Security, pointing at the platform pages', () => {
    render(<NavbarSections tenantId={undefined} onPlatformSurface={true} />);

    expect(screen.getByText('Administration')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Security' }).getAttribute('href')).toBe('/platform/security');
  });

  it('renders nothing with no tenant outside the platform surface', () => {
    const { container } = render(<NavbarSections tenantId={undefined} onPlatformSurface={false} />);

    expect(container.childElementCount).toBe(0);
  });
});
