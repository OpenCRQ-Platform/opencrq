import { t } from '@lingui/core/macro';
import { linkOptions, useLocation } from '@tanstack/react-router';
import { Briefcase, Bug, Crosshair, Factory, Flag, Server, Tag, Target, TrendingDown, TriangleAlert } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { NavToolbarMenu } from '../layout/settings-layout/nav-toolbar-menu';

export const TaxonomiesToolbarMenu: FunctionComponent = () => {
  const { pathname } = useLocation();

  const entries = [
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/business-value-categories' }), label: t`Business Resources`, icon: <Briefcase /> },
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/supporting-asset-categories' }), label: t`Supporting Asset Categories`, icon: <Server /> },
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/tags' }), label: t`Tags`, icon: <Tag /> },
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/countries' }), label: t`Countries`, icon: <Flag /> },
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/sectors' }), label: t`Sectors`, icon: <Factory /> },
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/loss-drivers' }), label: t`Loss Drivers`, icon: <TrendingDown /> },
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/attack-outcomes' }), label: t`Attack Outcomes`, icon: <Target /> },
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/cve' }), label: t`CVE Catalog`, icon: <TriangleAlert /> },
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/cwe' }), label: t`CWE Catalog`, icon: <Bug /> },
    {
      label: t`MITRE ATT&CK`,
      icon: <Crosshair />,
      matchRoute: () => pathname.includes('/settings/taxonomies/mitre-attack'),
      children: [
        { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/mitre-attack/matrix' }), label: t`Matrix` },
        { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/mitre-attack/tactics' }), label: t`Tactics` },
        { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/mitre-attack/techniques' }), label: t`Techniques` },
        { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/mitre-attack/mitigations' }), label: t`Mitigations` },
      ],
    },
  ];

  return <NavToolbarMenu entries={entries} />;
};
