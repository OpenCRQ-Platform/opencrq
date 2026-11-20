import { includesFolded } from '@app/utils/text-fold';
import { SearchField, Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import { Check, Info, X } from 'lucide-react';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
  Separator,
} from '@filigran/ui';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import type { FunctionComponent, ReactNode } from 'react';
import { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import type { EffectivePermissionRow, Provenance } from '../effective-permissions-utils';
import { TooltipHintProvider } from '../../../components/shared';
import { provenanceByCapability, provenanceKey, summarizeEffectivePermissions } from '../effective-permissions-utils';

const OTHER_CATEGORY = '__other__';

interface CapabilityWithProvenance {
  id: string,
  displayName: string,
  description: string | null,
  granted: boolean,
  provenance: Array<Provenance>,
}

interface CategoryGroup {
  categoryKey: string,
  categoryLabel: string,
  capabilities: Array<CapabilityWithProvenance>,
  grantedCount: number,
  totalCount: number,
}

export type CapabilitiesMap = Record<string, { category: MessageDescriptor, capabilities: Record<string, { name: MessageDescriptor, description?: MessageDescriptor }> }>;

export interface EffectivePermissionsViewProps {
  allCapabilities: Array<{ id: string, name: string }>,
  effectivePermissions: Array<EffectivePermissionRow>,
  capabilitiesMap: CapabilitiesMap,
  renderRoleEditor: (roleId: string, onClose: () => void) => ReactNode,
}

export const EffectivePermissionsView: FunctionComponent<EffectivePermissionsViewProps> = ({
  allCapabilities,
  effectivePermissions,
  capabilitiesMap,
  renderRoleEditor,
}) => {
  const [search, setSearch] = useState('');
  const [editRoleId, setEditRoleId] = useState<string | undefined>();

  const categories: Array<CategoryGroup> = (() => {
    const provenanceMap = provenanceByCapability(effectivePermissions);

    const groups: Record<string, Array<CapabilityWithProvenance>> = {};
    for (const category of Object.keys(capabilitiesMap)) {
      groups[category] = [];
    }
    groups[OTHER_CATEGORY] = [];

    for (const cap of allCapabilities) {
      let foundCategory = OTHER_CATEGORY;
      let displayName = cap.name;
      let description: string | null = null;

      for (const [category, entry] of Object.entries(capabilitiesMap)) {
        if (cap.id in entry.capabilities) {
          foundCategory = category;
          const info = entry.capabilities[cap.id];
          displayName = i18n._(info.name);
          description = info.description ? i18n._(info.description) : null;
          break;
        }
      }

      const provenance = provenanceMap.get(cap.id) ?? [];
      if (!groups[foundCategory]) {
        groups[foundCategory] = [];
      }
      groups[foundCategory].push({
        id: cap.id,
        displayName,
        description,
        granted: provenance.length > 0,
        provenance,
      });
    }

    return Object.entries(groups)
      .filter(([, caps]) => caps.length > 0)
      .map(([categoryKey, caps]) => {
        const mapEntry = capabilitiesMap[categoryKey];
        return {
          categoryKey,
          categoryLabel: mapEntry ? i18n._(mapEntry.category) : t`Other`,
          capabilities: caps,
          grantedCount: caps.filter((c) => c.granted).length,
          totalCount: caps.length,
        };
      });
  })();

  const summary = summarizeEffectivePermissions(effectivePermissions);

  const filteredCategories = (() => {
    if (!search.trim()) {
      return categories;
    }
    return categories
      .map((cat) => ({
        ...cat,
        capabilities: cat.capabilities.filter((c) => includesFolded(c.displayName, search)),
      }))
      .filter((cat) => cat.capabilities.length > 0);
  })();

  if (allCapabilities.length === 0) {
    return <span className="text-sm text-muted-foreground">{t`No capabilities defined.`}</span>;
  }

  const grantedCount = summary.grantedCount;
  const totalCount = allCapabilities.length;
  const groupCount = summary.groupCount;
  const roleCount = summary.roleCount;

  return (
    <div className="flex flex-col gap-4">
      <span className="text-sm text-muted-foreground">
        {summary.superAdministrator
          ? <Trans>{grantedCount} of {totalCount} capabilities granted as super administrator (XTM One) and via {groupCount} groups, {roleCount} roles</Trans>
          : <Trans>{grantedCount} of {totalCount} capabilities granted via {groupCount} groups, {roleCount} roles</Trans>}
      </span>

      <SearchField
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onClear={() => setSearch('')}
        clearLabel={t`Clear search`}
        placeholder={t`Search capabilities...`}
        fullWidth
      />

      <Accordion
        type="multiple"
        defaultValue={filteredCategories.map((c) => c.categoryKey)}
        className="space-y-2"
      >
        {filteredCategories.map((category) => (
          <AccordionItem
            key={category.categoryKey}
            value={category.categoryKey}
            className="overflow-hidden rounded-lg border"
          >
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <div className="flex flex-1 items-center justify-between pr-4">
                <span className="font-semibold">{category.categoryLabel}</span>
                <span className="text-sm text-muted-foreground">
                  {category.grantedCount}/{category.totalCount}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-0 pb-0">
              <div className="flex flex-col">
                {category.capabilities.map((cap, index) => (
                  <div key={cap.id}>
                    <div className="flex items-start gap-3 px-4 py-3">
                      {cap.granted
                        ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                        : <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                      <div className="flex flex-1 flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className={cap.granted ? 'text-sm font-semibold' : 'text-sm text-muted-foreground'}>
                            {cap.displayName}
                          </span>
                          {cap.description && (
                            <TooltipHintProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="h-4 w-4 text-muted-foreground" />
                                </TooltipTrigger>
                                <TooltipContent side="top">{cap.description}</TooltipContent>
                              </Tooltip>
                            </TooltipHintProvider>
                          )}
                        </div>
                        {cap.granted && cap.provenance.length > 0 && (
                          <div className="flex flex-col gap-0.5">
                            {cap.provenance.map((p) => (p.kind === 'super_administrator'
                              ? (
                                <span key={provenanceKey(p)} className="text-xs text-muted-foreground">
                                  <Trans>via <span className="font-medium text-foreground">Super administrator (XTM One)</span></Trans>
                                </span>
                              )
                              : (
                                <span key={provenanceKey(p)} className="text-xs text-muted-foreground">
                                  {t`via`}{' '}
                                  <span className="font-medium text-foreground">{p.groupName}</span>
                                  {' → '}
                                  <button
                                    type="button"
                                    onClick={() => setEditRoleId(p.roleId)}
                                    className="font-medium text-primary underline hover:no-underline"
                                  >
                                    {p.roleName}
                                  </button>
                                </span>
                              )))}
                          </div>
                        )}
                      </div>
                    </div>
                    {index < category.capabilities.length - 1 && <Separator />}
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {editRoleId && renderRoleEditor(editRoleId, () => setEditRoleId(undefined))}
    </div>
  );
};
