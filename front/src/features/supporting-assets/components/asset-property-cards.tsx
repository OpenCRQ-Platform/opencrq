import { t } from '@lingui/core/macro';
import { UserRound } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import type { AssetObservationProperties } from '@app/module/client';
import { CardField, CollapsibleField, InfoField, SectionCard, TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { BadgeGroup } from '../../../components/ui/badge-group';
import { EmptyValue } from '../../../components/ui/empty-value';
import {
  abbreviateIpAddress,
  formatIpAddress,
  formatMacAddress,
  getAiTargetModalityLabel,
  getAiTargetProviderLabel,
  getAssetIdentityProviderLabel,
  getCloudProviderLabel,
  getEndpointArchLabel,
  getEndpointPlatformLabel,
} from '../../../utils';
import { isManualPropertyValue } from '../asset-manual-attribute-vocabulary';
import { hasIdentityDetail } from '../identity-detail-utils';

/** The marker `overview.tsx`'s scalar fields already carry — reused here rather than a second "set by user" mechanism. */
export const SetByUserMarker: FunctionComponent<{ isManual: boolean }> = ({ isManual }) => (
  isManual
    ? (
      <span title={t`Set by user`}>
        <UserRound className="h-3.5 w-3.5 text-muted-foreground" aria-label={t`Set by user`} />
      </span>
    )
    : null
);

const propertyFieldTitle = (label: ReactNode, isManual: boolean): ReactNode => (
  <span className="flex items-center gap-1.5">
    {label}
    <SetByUserMarker isManual={isManual} />
  </span>
);

/** One line whatever the count: a heavily privileged account holds a dozen roles, the rest fold into `+n`. */
const RoleChips = ({ roles }: { roles: ReadonlyArray<string> }) => (
  <BadgeGroup chipClassName="max-w-[200px]" items={roles.map((role) => ({ title: role }))} />
);

const Address: FunctionComponent<{ shown: string, whole: string }> = ({ shown, whole }) => (shown === whole
  ? <p>{whole}</p>
  : (
    <TooltipHint hint={whole}>
      {/* Focusable so the tooltip opens from the keyboard too; the hidden text gives assistive technology the whole address. */}
      <p tabIndex={0} className="w-fit">
        <span aria-hidden>{shown}</span>
        <span className="sr-only">{whole}</span>
      </p>
    </TooltipHint>
  ));

/**
 * One address per line, with nothing to separate them. A long IPv6 address is abbreviated in its
 * middle rather than wrapped, which would split it where it is least readable.
 */
const AddressListField: FunctionComponent<{ title: ReactNode, addresses: ReadonlyArray<string>, shown: (address: string) => string, whole: (address: string) => string }> = ({ title, addresses, shown, whole }) => (
  <CardField title={title}>
    {addresses.length === 0
      ? <p><EmptyValue /></p>
      : (
        <TooltipHintProvider>
          {addresses.map((address) => <Address key={address} shown={shown(address)} whole={whole(address)} />)}
        </TooltipHintProvider>
      )}
  </CardField>
);

interface AssetPropertyCardsProps {
  /** The asset's merged family block — a connector's own reading, a person's, or a mix of both, field by field. */
  properties: AssetObservationProperties | null,
  /** The manual observation alone, never merged with a connector's — what marks a field "set by user" below. */
  manualProperties: AssetObservationProperties | null,
}

/**
 * The AI target connection, Network, Machine, Cloud and Identity cards of the asset overview page, extracted
 * so they can be mounted in a test without the route's loader and tRPC query.
 */
export const AssetPropertyCards: FunctionComponent<AssetPropertyCardsProps> = ({ properties, manualProperties }) => {
  const manualMachine = manualProperties?.family === 'machine' ? manualProperties : null;
  const manualAiTarget = manualProperties?.family === 'ai_target' ? manualProperties : null;
  const manualIdentity = manualProperties?.family === 'identity' ? manualProperties : null;

  return (
    <>
      {properties?.family === 'ai_target' && (
        <SectionCard title={t`AI target connection`} contentClassName="grid grid-cols-2 gap-x-6 gap-y-5">
          <InfoField
            title={propertyFieldTitle(t`Provider`, isManualPropertyValue(manualAiTarget?.provider))}
            value={properties.provider ? getAiTargetProviderLabel(properties.provider) : null}
          />
          <InfoField
            title={propertyFieldTitle(t`Modality`, isManualPropertyValue(manualAiTarget?.modality))}
            value={properties.modality ? getAiTargetModalityLabel(properties.modality) : null}
          />
          <InfoField title={propertyFieldTitle(t`Model`, isManualPropertyValue(manualAiTarget?.model))} value={properties.model} />
          <InfoField title={propertyFieldTitle(t`Endpoint URL`, isManualPropertyValue(manualAiTarget?.endpointUrl))} value={properties.endpointUrl} />
          <CollapsibleField
            className="col-span-2"
            title={propertyFieldTitle(t`System prompt`, isManualPropertyValue(manualAiTarget?.systemPrompt))}
            value={properties.systemPrompt}
          />
        </SectionCard>
      )}

      {properties?.family === 'machine' && (
        <>
          <SectionCard title={t`Network`} contentClassName="grid grid-cols-2 gap-x-6 gap-y-5">
            {/* A grid cell never breaks inside a token by itself: a long FQDN would spill over the next column. */}
            <InfoField className="min-w-0 [overflow-wrap:anywhere]" title={propertyFieldTitle(t`Hostname`, isManualPropertyValue(manualMachine?.hostname))} value={properties.hostname} />
            <AddressListField
              title={propertyFieldTitle(t`Seen IP`, isManualPropertyValue(manualMachine?.seenIp))}
              addresses={properties.seenIp === null ? [] : [properties.seenIp]}
              shown={abbreviateIpAddress}
              whole={formatIpAddress}
            />
            <AddressListField
              title={propertyFieldTitle(t`IP addresses`, isManualPropertyValue(manualMachine?.ipAddresses))}
              addresses={properties.ipAddresses}
              shown={abbreviateIpAddress}
              whole={formatIpAddress}
            />
            <AddressListField
              title={propertyFieldTitle(t`MAC addresses`, isManualPropertyValue(manualMachine?.macAddresses))}
              addresses={properties.macAddresses}
              shown={formatMacAddress}
              whole={formatMacAddress}
            />
          </SectionCard>

          <SectionCard title={t`Machine`} contentClassName="grid grid-cols-2 gap-x-6 gap-y-5">
            <InfoField
              title={propertyFieldTitle(t`Platform`, isManualPropertyValue(manualMachine?.platform))}
              value={properties.platform ? getEndpointPlatformLabel(properties.platform) : null}
            />
            <InfoField
              title={propertyFieldTitle(t`Architecture`, isManualPropertyValue(manualMachine?.arch))}
              value={properties.arch ? getEndpointArchLabel(properties.arch) : null}
            />
            <InfoField title={propertyFieldTitle(t`Operating system`, isManualPropertyValue(manualMachine?.operatingSystem))} value={properties.operatingSystem} />
            <InfoField title={propertyFieldTitle(t`OS version`, isManualPropertyValue(manualMachine?.osVersion))} value={properties.osVersion} />
            <InfoField title={propertyFieldTitle(t`Vendor`, isManualPropertyValue(manualMachine?.vendor))} value={properties.vendor} />
            <InfoField title={propertyFieldTitle(t`Model`, isManualPropertyValue(manualMachine?.model))} value={properties.model} />
            <InfoField
              title={propertyFieldTitle(t`End of life`, isManualPropertyValue(manualMachine?.isEol))}
              value={properties.isEol === null ? null : (properties.isEol ? t`Yes` : t`No`)}
            />
          </SectionCard>
        </>
      )}

      {properties?.family === 'machine' && (properties.cloudProvider !== null || properties.cloudNativeType !== null || properties.cloudRegion !== null) && (
        <SectionCard title={t`Cloud`} contentClassName="grid grid-cols-2 gap-x-6 gap-y-5">
          <InfoField
            title={propertyFieldTitle(t`Cloud provider`, isManualPropertyValue(manualMachine?.cloudProvider))}
            value={properties.cloudProvider && getCloudProviderLabel(properties.cloudProvider)}
          />
          <InfoField title={propertyFieldTitle(t`Native type`, isManualPropertyValue(manualMachine?.cloudNativeType))} value={properties.cloudNativeType} />
          <InfoField title={propertyFieldTitle(t`Region`, isManualPropertyValue(manualMachine?.cloudRegion))} value={properties.cloudRegion} />
        </SectionCard>
      )}

      {properties?.family === 'identity' && hasIdentityDetail(properties) && (
        <SectionCard title={t`Identity`} contentClassName="grid grid-cols-2 gap-x-6 gap-y-5">
          {properties.userPrincipalName !== null && (
            <InfoField title={propertyFieldTitle(t`User principal name`, isManualPropertyValue(manualIdentity?.userPrincipalName))} value={properties.userPrincipalName} />
          )}
          {properties.accountName !== null && (
            <InfoField title={propertyFieldTitle(t`Account name`, isManualPropertyValue(manualIdentity?.accountName))} value={properties.accountName} />
          )}
          {properties.accountDomain !== null && (
            <InfoField title={propertyFieldTitle(t`Account domain`, isManualPropertyValue(manualIdentity?.accountDomain))} value={properties.accountDomain} />
          )}
          {properties.identityProvider !== null && (
            <InfoField
              title={propertyFieldTitle(t`Directory`, isManualPropertyValue(manualIdentity?.identityProvider))}
              value={getAssetIdentityProviderLabel(properties.identityProvider)}
            />
          )}
          {properties.cloudSid !== null && <InfoField title={t`Cloud SID`} value={properties.cloudSid} />}
          {properties.onPremSid !== null && <InfoField title={t`On-premises SID`} value={properties.onPremSid} />}
          {properties.department !== null && (
            <InfoField title={propertyFieldTitle(t`Department`, isManualPropertyValue(manualIdentity?.department))} value={properties.department} />
          )}
          {properties.jobTitle !== null && (
            <InfoField title={propertyFieldTitle(t`Job title`, isManualPropertyValue(manualIdentity?.jobTitle))} value={properties.jobTitle} />
          )}
          {properties.isEnabled !== null && (
            <InfoField
              title={propertyFieldTitle(t`Account enabled`, isManualPropertyValue(manualIdentity?.isEnabled))}
              value={properties.isEnabled ? t`Yes` : t`No`}
            />
          )}
          {properties.assignedRoles.length > 0 && (
            <CardField className="col-span-2" title={propertyFieldTitle(t`Directory roles`, isManualPropertyValue(manualIdentity?.assignedRoles))}>
              <RoleChips roles={properties.assignedRoles} />
            </CardField>
          )}
          {properties.privilegedPimRoles.length > 0 && (
            <CardField className="col-span-2" title={propertyFieldTitle(t`Privileged PIM roles`, isManualPropertyValue(manualIdentity?.privilegedPimRoles))}>
              <RoleChips roles={properties.privilegedPimRoles} />
            </CardField>
          )}
        </SectionCard>
      )}
    </>
  );
};
