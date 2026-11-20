export interface RouteTabKey {
  key: string,
}

/**
 * Which tab a pathname activates.
 *
 * Deep routes keep their section's tab active: the first pathname segment naming a tab wins, so
 * `/risk-scenarios/<id>/overview` activates `risk-scenarios`, not a sibling `overview` tab. A
 * pathname naming no tab falls back to the first one, which is what keeps an index route active.
 */
export const resolveActiveTabKey = (pathname: string, tabs: Array<RouteTabKey>): string | undefined => {
  const segments = pathname.split('/').filter(Boolean);
  return segments.find((segment) => tabs.some((tab) => tab.key === segment)) ?? tabs[0]?.key;
};
