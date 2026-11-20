import { Checkbox, Tooltip, TooltipContent, TooltipTrigger } from '@filigran/design-system';
import { Separator } from '@filigran/ui';
import type { MessageDescriptor } from '@lingui/core';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Info } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import { TooltipHintProvider } from './tooltip-hint';

export type CapabilitiesMap = Record<string, {
  category: MessageDescriptor,
  capabilities: Record<string, { name: MessageDescriptor, description?: MessageDescriptor }>,
}>;

interface CapabilitiesChecklistProps {
  title: string,
  capabilities: Array<{ id: string, name: string }>,
  selectedIds: Array<string>,
  capabilitiesMap: CapabilitiesMap,
  onToggle: (id: string, checked: boolean) => void,
  footer?: ReactNode,
}

const OTHER_CATEGORY = '__other__';

export const CapabilitiesChecklist: FunctionComponent<CapabilitiesChecklistProps> = ({
  title,
  capabilities,
  selectedIds,
  capabilitiesMap,
  onToggle,
  footer,
}) => {
  const selectedSet = new Set(selectedIds);
  const assignedCount = selectedIds.length;
  const totalCount = capabilities.length;

  const groupedCapabilities = (() => {
    const groups: Record<string, typeof capabilities> = {};

    Object.keys(capabilitiesMap).forEach((category) => {
      groups[category] = [];
    });
    groups[OTHER_CATEGORY] = [];

    capabilities.forEach((capability) => {
      let foundCategory = OTHER_CATEGORY;
      for (const [category, entry] of Object.entries(capabilitiesMap)) {
        if (capability.id in entry.capabilities) {
          foundCategory = category;
          break;
        }
      }

      if (!groups[foundCategory]) {
        groups[foundCategory] = [];
      }
      groups[foundCategory].push(capability);
    });

    Object.keys(groups).forEach((key) => {
      if (groups[key].length === 0) {
        delete groups[key];
      }
    });

    return groups;
  })();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="txt-sub-content font-normal">{title}</span>
        <span className="txt-sub-content text-muted-foreground">
          <Trans>{assignedCount} of {totalCount} assigned</Trans>
        </span>
      </div>
      <div className="flex flex-col gap-4">
        {Object.entries(groupedCapabilities).map(([category, categoryCapabilities]) => {
          const mapEntry = capabilitiesMap[category];
          const categoryLabel = mapEntry ? i18n._(mapEntry.category) : t`Other`;
          return (
            <div key={category} className="flex flex-col gap-2">
              <span className="txt-sub-content font-normal">{categoryLabel}</span>
              <div className="flex flex-col gap-0 border rounded-md">
                {categoryCapabilities.map((capability, index) => {
                  const isChecked = selectedSet.has(capability.id);
                  const capabilityInfo = mapEntry?.capabilities[capability.id] ?? null;
                  const capabilityLabel = capabilityInfo?.name ? i18n._(capabilityInfo.name) : capability.name;

                  return (
                    <div key={capability.id}>
                      <div className="flex items-center gap-2 py-3 px-2">
                        <div className="flex flex-1 items-center gap-2">
                          <span className="txt-body2 font-medium">{capabilityLabel}</span>
                          {capabilityInfo?.description && (
                            <TooltipHintProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <Info className="h-4 w-4 text-muted-foreground" />
                                </TooltipTrigger>
                                <TooltipContent>{i18n._(capabilityInfo.description)}</TooltipContent>
                              </Tooltip>
                            </TooltipHintProvider>
                          )}
                        </div>
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={(checked) => onToggle(capability.id, !!checked)}
                          aria-label={capabilityLabel}
                        />
                      </div>
                      {index < (categoryCapabilities.length - 1) && <Separator />}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {footer}
    </div>
  );
};
