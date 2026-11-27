import { Icon } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { linkOptions, useLocation } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { NavToolbarMenu } from '../layout/settings-layout/nav-toolbar-menu';

export const TaxonomiesToolbarMenu: FunctionComponent = () => {
  const { pathname } = useLocation();

  const entries = [
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/business-value-categories' }), label: t`Business Resources`, icon: <Icon name="briefcase" size={16} /> },
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/supporting-asset-categories' }), label: t`Supporting Asset Categories`, icon: <Icon name="server" size={16} /> },
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/tags' }), label: t`Tags`, icon: <Icon name="tag" size={16} /> },
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/dependency-resource-types' }), label: t`Dependency Resource Types`, icon: <Icon name="route" size={16} /> },
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/countries' }), label: t`Countries`, icon: <Icon name="flag" size={16} /> },
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/sectors' }), label: t`Sectors`, icon: <Icon name="custom/city" size={16} /> },
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/loss-drivers' }), label: t`Loss Drivers`, icon: <Icon name="arrow-down-left" size={16} /> },
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/attack-outcomes' }), label: t`Attack Outcomes`, icon: <Icon name="custom/target" size={16} /> },
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/cve' }), label: t`CVE Catalog`, icon: <Icon name="triangle-alert" size={16} /> },
    { linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/cwe' }), label: t`CWE Catalog`, icon: <Icon name="bug" size={16} /> },
    {
      label: t`MITRE ATT&CK`,
      icon: <Icon name="custom/attack-pattern" size={16} />,
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
