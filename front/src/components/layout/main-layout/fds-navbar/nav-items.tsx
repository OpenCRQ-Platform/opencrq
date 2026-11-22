import { Icon, NavbarItem, NavbarSeparator, NavbarSubmenu, NavbarSubmenuItem, ProgressBar, Text, useNavbarCollapsed } from '@filigran/design-system';
import { Link, useMatchRoute } from '@tanstack/react-router';
import type { FunctionComponent, ReactNode } from 'react';
import type { NavEntry, NavGroup, NavNode, NavScope, NavSingle } from './nav-model';
import { cn } from '../../../../utils';
import { NavbarRowContent, NavbarSubmenuRowContent } from './navbar-row-content';

// The design system's row icon: 16 px, from its registry, in every Filigran product's left navigation.
const ICON_SIZE = 16;

/*
 * aria-current is left to TanStack Link at runtime, never passed as a JSX prop: the design
 * system's hasActiveDescendant reads children props, and a prop would mark the group trigger
 * active, which the reference implementation (design-system docs site) never does.
 */

interface NavSingleRowProps {
  node: NavSingle,
}

const NavSingleRow: FunctionComponent<NavSingleRowProps> = ({ node }) => {
  const collapsed = useNavbarCollapsed();

  return (
    <>
      <NavbarItem
        asChild
        tooltipLabel={node.label}
      >
        <Link
          {...node.link}
          activeOptions={{ exact: node.exact === true }}
        >
          <NavbarRowContent icon={<Icon name={node.icon} size={ICON_SIZE} />}>
            {node.label}
          </NavbarRowContent>
        </Link>
      </NavbarItem>
      {node.progress !== undefined && !collapsed && (
        // The row is a fixed-height link, so the bar sits under it rather than inside it. The padding lines the bar up with the row's icon.
        <div className="flex items-center gap-2 pb-2 pl-[18px] pr-[10px]">
          <ProgressBar
            value={node.progress.value}
            aria-label={node.label}
            aria-valuetext={node.progress.label}
            className="flex-1"
          />
          <Text as="span" variant="content-caption" className="whitespace-nowrap tabular-nums text-default-secondary">
            {node.progress.label}
          </Text>
        </div>
      )}
    </>
  );
};

// A helper, not a component: while collapsed, NavbarSubmenu wraps each direct child in a Radix
// DropdownMenu item slot whose props must merge onto a prop-forwarding element (NavbarSubmenuItem).
const renderSubmenuEntry = (entry: NavEntry): ReactNode => (
  <NavbarSubmenuItem key={entry.id} asChild>
    <Link
      {...entry.link}
      activeOptions={{ exact: entry.exact === true }}
    >
      <NavbarSubmenuRowContent>{entry.label}</NavbarSubmenuRowContent>
    </Link>
  </NavbarSubmenuItem>
);

interface NavGroupRowProps {
  group: NavGroup,
  expandedHeader?: ReactNode,
}

const NavGroupRow: FunctionComponent<NavGroupRowProps> = ({ group, expandedHeader }) => {
  const collapsed = useNavbarCollapsed();
  const matchRoute = useMatchRoute();
  // The design system looks for the current page in its children's props, where aria-current never
  // is (see above), so a group reached by a direct link or a reload is opened from the location.
  const holdsCurrentPage = group.entries.some((entry) => matchRoute({ to: entry.link.to, params: entry.link.params, fuzzy: entry.exact !== true }) !== false);
  // Collapsed, the same open state drives the group's flyout, which must never open on its own.
  const openOnMount = holdsCurrentPage && !collapsed;

  return (
    <NavbarSubmenu
      // NavbarSubmenu reads `defaultOpen` at mount only, and its inputs can arrive after that: the rail's
      // persisted collapsed state, entries gated by a permission query, a client-side navigation into the
      // group. Keyed on the wanted state, the submenu is mounted again whenever it changes, as scopes are
      // keyed on the current one in fds-navbar.tsx; the user can still fold the group in between.
      key={openOnMount ? 'open' : 'closed'}
      label={group.label}
      icon={<Icon name={group.icon} size={ICON_SIZE} />}
      defaultOpen={openOnMount}
    >
      {collapsed ? null : expandedHeader}
      {group.entries.map((entry) => renderSubmenuEntry(entry))}
    </NavbarSubmenu>
  );
};

interface ScopeInitialsProps {
  initials: string,
  current: boolean,
}

// The initials are painted from an attribute, never as text: the design system builds a truncated
// row's tooltip from the row's whole textContent, icon slot included.
const ScopeInitials: FunctionComponent<ScopeInitialsProps> = ({ initials, current }) => (
  <Text
    as="span"
    variant="content-caption"
    data-initials={initials}
    className={cn(
      'flex size-[18px] items-center justify-center rounded-sm font-semibold before:content-[attr(data-initials)]',
      current
        ? 'bg-filigran-brand-primary-transparency-10 text-filigran-brand-primary'
        : 'bg-feedback-neutral-secondary-transparency-30 text-default-secondary',
    )}
  >
    {null}
  </Text>
);

const NavScopeRow: FunctionComponent<{ scope: NavScope }> = ({ scope }) => (
  <NavbarSubmenu
    label={scope.label}
    icon={<ScopeInitials initials={scope.initials} current={scope.current} />}
    defaultOpen={scope.current}
  >
    {scope.entries.map((entry) => renderSubmenuEntry(entry))}
  </NavbarSubmenu>
);

interface NavNodeRowProps {
  node: NavNode,
  expandedHeader?: ReactNode,
}

export const NavNodeRow: FunctionComponent<NavNodeRowProps> = ({ node, expandedHeader }) => {
  if (node.kind === 'separator') {
    return <NavbarSeparator />;
  }
  if (node.kind === 'scope') {
    return <NavScopeRow scope={node} />;
  }
  if (node.kind === 'group') {
    return (
      <NavGroupRow
        group={node}
        expandedHeader={expandedHeader}
      />
    );
  }
  return <NavSingleRow node={node} />;
};

interface NavRowsProps {
  nodes: Array<NavNode>,
  organizationId?: string,
}

export const NavRows: FunctionComponent<NavRowsProps> = ({ nodes, organizationId }) => (
  <>
    {nodes.map((node) => (
      // A scope submenu reads `defaultOpen` at mount only, so it is keyed on the current scope to follow the page.
      <NavNodeRow
        key={node.kind === 'scope' ? `${node.id}:${organizationId ?? ''}` : node.id}
        node={node}
      />
    ))}
  </>
);
