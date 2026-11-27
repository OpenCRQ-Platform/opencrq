import { t } from '@lingui/core/macro';
import { linkOptions } from '@tanstack/react-router';
import type { Link, LinkOptions } from '@tanstack/react-router';
import type { IconName } from '@filigran/design-system';
import type { ComponentProps } from 'react';
import { scopeInitials } from './scope-nav-utils';

type NavLinkOptions = ComponentProps<typeof Link>;

// Link's props resolve params against no router in particular, so explicit params type-check only as `LinkOptions`.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the same object Link receives, already validated against the registered routes
const scopedLink = (options: LinkOptions): NavLinkOptions => options as NavLinkOptions;

interface NavNodeBase {
  id: string,
  visible?: boolean,
}

export interface NavEntry extends NavNodeBase {
  label: string,
  link: NavLinkOptions,
  exact?: boolean,
}

export interface NavSingle extends NavEntry {
  kind: 'single',
  /** A name of the design system's icon registry: one concept, one glyph, in every Filigran product. */
  icon: IconName,
  /** A bar under the row while the menu is expanded: `value` is a percentage, `label` the figure beside it. */
  progress?: { value: number, label: string },
}

export interface NavGroup extends NavNodeBase {
  kind: 'group',
  label: string,
  icon: IconName,
  entries: Array<NavEntry>,
}

export interface NavSeparator extends NavNodeBase {
  kind: 'separator',
}

export interface NavScope extends NavNodeBase {
  kind: 'scope',
  label: string,
  initials: string,
  /** The scope the current page belongs to, whose submenu opens. */
  current: boolean,
  entries: Array<NavEntry>,
}

export type NavNode = NavSingle | NavGroup | NavSeparator | NavScope;

export const filterVisibleEntries = (nodes: Array<NavNode>): Array<NavNode> => nodes
  .filter((node) => node.visible !== false)
  .map((node) => (node.kind === 'group' || node.kind === 'scope'
    ? { ...node, entries: node.entries.filter((entry) => entry.visible !== false) }
    : node))
  .filter((node) => (node.kind !== 'group' && node.kind !== 'scope') || node.entries.length > 0);

/** Points a link at one scope, or at the tenant with undefined. */
interface ScopeParams {
  tenantId: string,
  organizationId: string | undefined,
}

const threatsNode = (params: ScopeParams): NavNode => ({
  kind: 'group',
  id: 'threats',
  label: t`Threats`,
  icon: 'custom/threat-actor-individual',
  entries: [
    {
      id: 'threat-center',
      label: t`Threats`,
      link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/threat-center', params })),
    },
    {
      id: 'threat-event-frequency',
      label: t`Threat Event Frequency`,
      link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/threat-event-frequency', params })),
    },
  ],
});

interface GetStartedNavProgress {
  /** The steps that are done. */
  completed: number,
  total: number,
  /** The backend's verdict, not `completed === total`: a started step never holds the wizard back. */
  finished: boolean,
}

/** Once the wizard is finished the entry only leads back to it: no counter, no bar. */
const getStartedNode = ({ completed, total, finished }: GetStartedNavProgress, params: ScopeParams): NavNode => ({
  kind: 'single',
  id: 'get-started',
  label: t`Get started`,
  icon: 'rocket',
  link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/get-started', params })),
  progress: finished ? undefined : { value: total === 0 ? 0 : completed / total * 100, label: t`${completed} of ${total}` },
});

const settingsGroup = (entries: Array<NavEntry>): NavGroup => ({
  kind: 'group',
  id: 'settings',
  label: t`Settings`,
  icon: 'settings',
  entries,
});

const settingsNode = (hasManageSecurity: boolean, hasPlatformAccess: boolean, params: ScopeParams): NavNode => settingsGroup([
  {
    id: 'settings-parameters',
    label: t`Parameters`,
    link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/settings/parameters', params })),
  },
  {
    id: 'settings-file-storage',
    label: t`File Storage`,
    link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/settings/file-storage', params })),
  },
  {
    id: 'settings-security',
    label: t`Security`,
    link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/settings/security', params })),
    visible: hasManageSecurity || hasPlatformAccess,
  },
  {
    id: 'settings-taxonomies',
    label: t`Taxonomies`,
    link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/settings/taxonomies', params })),
  },
  {
    id: 'settings-engine',
    label: t`Engine`,
    link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/settings/engine', params })),
    visible: hasManageSecurity,
  },
  {
    id: 'settings-jobs',
    label: t`Jobs`,
    link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/settings/jobs', params })),
    visible: hasManageSecurity || hasPlatformAccess,
  },
]);

/** The tenant-less platform surface carries Security alone, so its Settings group holds that one entry. */
export const getPlatformNavigationNodes = (): Array<NavNode> => [
  settingsGroup([
    { id: 'settings-security', label: t`Security`, link: scopedLink(linkOptions({ to: '/platform/security' })) },
  ]),
];

interface ScopeNavigationInput {
  tenantId: string,
  hasManageSecurity: boolean,
  hasPlatformAccess: boolean,
  organizationId: string | undefined,
  /** In the order the bar shows them. */
  scopes: Array<{ id: string, name: string }>,
  /** The Get started wizard's progress, undefined where the entry must not show. */
  getStarted?: GetStartedNavProgress,
}

const scopeEntries = (tenantId: string, organizationId: string): Array<NavEntry> => {
  const params: ScopeParams = { tenantId, organizationId };
  return [
    { id: 'overview', label: t`Overview`, link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}', params })), exact: true },
    { id: 'dashboards', label: t`Dashboards`, link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/dashboards', params })) },
    { id: 'risk-scenarios', label: t`Risk Scenarios`, link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/risk-scenarios', params })) },
    { id: 'treatment-plans', label: t`Treatment Plans`, link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/treatment-plans', params })) },
    { id: 'budget-reviews', label: t`Budget Reviews`, link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/budget-reviews', params })) },
    { id: 'primary-assets', label: t`Primary Assets`, link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/primary-assets', params })) },
    { id: 'requirements', label: t`Requirements`, link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/requirements', params })) },
    { id: 'assets', label: t`Assets`, link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/assets', params })) },
    { id: 'findings', label: t`Findings`, link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/findings', params })) },
    { id: 'threat-event-frequency', label: t`Threat Event Frequency`, link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/threat-event-frequency', params })) },
    { id: 'controls', label: t`Controls`, link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/controls', params })) },
    { id: 'details', label: t`Details`, link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/details', params })) },
  ];
};

/**
 * A tenant entry links out of any scope, so no entry changes meaning with the page it is clicked from.
 * Get started comes first in the menu while the wizard is unfinished, and last once it is finished.
 */
export const getScopeNavigationNodes = ({ tenantId, hasManageSecurity, hasPlatformAccess, organizationId, scopes, getStarted }: ScopeNavigationInput): Array<NavNode> => {
  const params: ScopeParams = { tenantId, organizationId: undefined };
  const getStartedNodes = getStarted === undefined ? [] : [getStartedNode(getStarted, params)];
  const getStartedComplete = getStarted?.finished === true;
  return [
    ...(getStartedComplete ? [] : getStartedNodes),
    { kind: 'single', id: 'home', label: t`Home`, icon: 'house', link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}', params })), exact: true },
    { kind: 'single', id: 'dashboards', label: t`Dashboards`, icon: 'layout-dashboard', link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/dashboards', params })) },
    { kind: 'single', id: 'risk-scenarios', label: t`Risk Scenarios`, icon: 'route', link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/risk-scenarios', params })) },
    { kind: 'single', id: 'treatment-plans', label: t`Treatment Plans`, icon: 'list-checks', link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/treatment-plans', params })) },
    { kind: 'single', id: 'budget-reviews', label: t`Budget Reviews`, icon: 'scale', link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/budget-reviews', params })) },
    // Blocks are set apart by a separator alone, no section title: the design system's integrated product frame, shared by every Filigran product.
    { kind: 'separator', id: 'separator-risk-scopes' },
    ...scopes
      .map((scope): NavScope => ({
        kind: 'scope',
        id: `scope-${scope.id}`,
        label: scope.name,
        initials: scopeInitials(scope.name),
        current: scope.id === organizationId,
        entries: scopeEntries(tenantId, scope.id),
      })),
    { kind: 'single', id: 'organizations', label: t`All risk scopes`, icon: 'building-2', link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/risk-scopes', params })) },
    { kind: 'separator', id: 'separator-attack-surface' },
    { kind: 'single', id: 'assets', label: t`Assets`, icon: 'server', link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/assets', params })) },
    { kind: 'single', id: 'findings', label: t`Findings`, icon: 'custom/binocular', link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/findings', params })) },
    threatsNode(params),
    { kind: 'separator', id: 'separator-defenses' },
    { kind: 'single', id: 'controls', label: t`Controls`, icon: 'shield-check', link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/controls', params })) },
    // Pointed at the layout rather than at the assessments, so it also lights on a Drata framework's page.
    { kind: 'single', id: 'compliance', label: t`Compliance`, icon: 'clipboard-check', link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/compliance', params })) },
    { kind: 'separator', id: 'separator-administration' },
    { kind: 'single', id: 'integrations', label: t`Integrations`, icon: 'puzzle', visible: hasManageSecurity, link: scopedLink(linkOptions({ to: '/$tenantId/{-$organizationId}/integrations', params })) },
    settingsNode(hasManageSecurity, hasPlatformAccess, params),
    ...(getStartedComplete ? getStartedNodes : []),
  ];
};
