import { Tabs, TabsList, TabsTrigger } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Link, useLocation } from '@tanstack/react-router';
import type { ComponentProps, FunctionComponent } from 'react';
import { resolveActiveTabKey } from './route-tabs-utils';
import { WarningDot } from './warning-dot';

export interface RouteTab {
  key: string,
  label: string,
  linkOption: Omit<ComponentProps<typeof Link>, 'children'>,
  warning?: boolean,
  count?: number,
}

const TabCountBadge: FunctionComponent<{ count: number }> = ({ count }) => (
  <span
    aria-label={t`${count} items`}
    className="inline-flex shrink-0 items-center justify-center px-1 rounded-sm font-content-caption text-content-caption leading-content-caption tracking-content-caption text-default-primary bg-filigran-brand-primary-transparency-10"
  >
    {count}
  </span>
);

export const RouteTabs: FunctionComponent<{ tabs: Array<RouteTab> }> = ({ tabs }) => {
  const location = useLocation();
  const activeTab = resolveActiveTabKey(location.pathname, tabs);

  return (
    <Tabs value={activeTab}>
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.key} value={tab.key} asChild className="relative">
            {/* A tab is a pathname change, which opens a page at the top: the tab bar would jump from under the cursor. */}
            <Link resetScroll={false} {...tab.linkOption}>
              <span className="truncate">{tab.label}</span>
              {/* TabsTrigger drops its own badge under asChild: this is the same badge, drawn inside the link. */}
              {tab.count !== undefined && <TabCountBadge count={tab.count} />}
              {tab.warning && <WarningDot variant="absolute" />}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
};
