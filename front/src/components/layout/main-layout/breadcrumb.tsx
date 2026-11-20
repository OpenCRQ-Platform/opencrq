import { Breadcrumbs } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Link, useMatches } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';

export const Breadcrumb: FunctionComponent = () => {
  const matches = useMatches();

  // `ancestorCrumbs` are entries no route of its own matches: a detail page reached from a tab still
  // names the tab it came from, and that tab is a sibling of the page, never one of its parents.
  // One without `to` names a menu group whose entries are sibling routes, so it links nowhere.
  const crumbs = matches.flatMap(({ pathname, loaderData, staticData }) => {
    const ancestors = loaderData && 'ancestorCrumbs' in loaderData
      ? loaderData.ancestorCrumbs.map((ancestor) => ({ label: ancestor.label, to: 'to' in ancestor ? ancestor.to : undefined }))
      : [];
    if (loaderData?.crumb) {
      return [...ancestors, { label: loaderData.crumb, to: staticData.isVirtual === true ? undefined : pathname }];
    }
    return ancestors;
  });

  const items = crumbs.map(({ label, to }, index) => {
    if (index === crumbs.length - 1) {
      return { label, current: true };
    }
    return to === undefined ? { label } : { label, to };
  });

  // A separator row is a full line box tall, a lone current entry only 18px:
  // without a floor, the page below jumps as soon as a second crumb appears.
  return (
    <Breadcrumbs
      className="mb-2 min-h-[1lh]"
      label={t`Breadcrumb`}
      items={items}
      linkComponent={Link}
    />
  );
};
