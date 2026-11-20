import { t } from '@lingui/core/macro';
import type { ConnectorSource } from '@app/module/client';
import { linkOptions } from '@tanstack/react-router';
import { connectorSlug } from '../connector-route-utils';

/** One address for every connector, its slug the only thing that differs. */
const connectorLink = (source: ConnectorSource) => linkOptions({
  from: '/$tenantId/{-$organizationId}',
  to: 'integrations/connectors/$connectorSlug',
  params: { connectorSlug: connectorSlug(source) },
});

export type ConnectorLinkOption = ReturnType<typeof connectorLink>;

interface ConnectorItem {
  name: string,
  /** The full copy, rendered on the connector's own page where the width carries it. */
  description: string,
  /** The card's copy: a card is a quarter of the content width, where fifty words bury the state. */
  shortDescription: string,
  type: string,
  icon: string,
  linkOption: ConnectorLinkOption,
}

export const getConnectors = (): Record<ConnectorSource, ConnectorItem> => ({
  first: {
    name: 'FIRST EPSS',
    description: t`FIRST's Exploit Prediction Scoring System (EPSS) is an open model designed to predict the likelihood of a vulnerability being exploited in the wild. By providing a score for each vulnerability, EPSS helps organizations prioritize vulnerability management efforts based on the potential risk and impact.`,
    type: t`VULNERABILITY`,
    shortDescription: t`Exploit prediction scores: the likelihood that a vulnerability is exploited in the wild, to rank remediation by real risk.`,
    icon: '/img/icon-first.png',
    linkOption: connectorLink('first'),
  },
  nist: {
    name: 'NIST NVD CVE',
    description: t`The NVD facilitates automated vulnerability management, security measurement, and compliance processes by providing comprehensive databases. CVE provides a standardized dictionary of publicly disclosed cybersecurity vulnerabilities and exposures, serving as a universal reference system for the security community.`,
    type: t`VULNERABILITY`,
    shortDescription: t`Comprehensive vulnerability databases with severity, references and affected versions for every published CVE.`,
    icon: '/img/icon-nist.png',
    linkOption: connectorLink('nist'),
  },
  cisa: {
    name: 'CISA Known Exploited Vulnerabilities (KEV)',
    description: t`CISA KEV (Known Exploited Vulnerabilities) is a catalog maintained by the Cybersecurity and Infrastructure Security Agency that lists vulnerabilities actively exploited in the wild. It serves as an authoritative resource for organizations to prioritize vulnerability remediation and enhance their security resilience.`,
    type: t`VULNERABILITY`,
    shortDescription: t`Vulnerabilities confirmed as actively exploited, the authoritative list for prioritising what to fix first.`,
    icon: '/img/icon-cisa.png',
    linkOption: connectorLink('cisa'),
  },
  microsoft_graph: {
    name: 'Microsoft Defender',
    description: t`Import assets and vulnerability data from Microsoft Defender via Graph API. Uses the runHuntingQuery endpoint to fetch the device inventory, the identities the directory and the logon events name, and software vulnerability data, enabling you to track CVEs and privileged accounts across your managed estate.`,
    type: t`VULNERABILITY`,
    shortDescription: t`Devices, identities and software vulnerabilities from your managed estate, to track CVEs and privileged accounts.`,
    icon: '/img/icon-microsoft-defender.png',
    linkOption: connectorLink('microsoft_graph'),
  },
  openaev: {
    name: 'OpenAEV',
    description: t`Import simulation results from OpenAEV. Syncs detection and prevention outcomes per MITRE technique and security platform (SIEM, EDR, etc.) as findings on your assets.`,
    type: t`SIMULATION`,
    shortDescription: t`Simulation results: detection and prevention outcomes per MITRE technique and security platform, landed as findings on your assets.`,
    icon: '/img/icon-openaev.png',
    linkOption: connectorLink('openaev'),
  },
  drata: {
    name: 'Drata',
    description: t`Import your compliance posture from Drata. Syncs your security frameworks (ISO 27001, SOC 2) with their requirements and control readiness, providing evidence to assess your security capabilities.`,
    type: t`COMPLIANCE`,
    shortDescription: t`Your compliance posture: security frameworks with their requirements and control readiness, as evidence for capability assessments.`,
    // Drata's own logo may not be shown in the product, so OpenCRQ's stands in for it.
    icon: '/img/icon-opencrq.svg',
    linkOption: connectorLink('drata'),
  },
  opencti: {
    name: 'OpenCTI',
    description: t`Automatically keep threat intelligence up to date by subscribing to an OpenCTI Live Stream, as an alternative to manually uploading STIX bundle files.`,
    type: t`THREAT INTELLIGENCE`,
    shortDescription: t`Threat intelligence kept current by subscribing to a Live Stream, instead of uploading STIX bundles by hand.`,
    icon: '/img/icon-opencti.png',
    linkOption: connectorLink('opencti'),
  },
  default_threats: {
    name: 'OpenCRQ Default Threats',
    description: t`Load the threats risk scenarios need from day one, for tenants without a threat feed of their own.`,
    type: t`THREAT INTELLIGENCE`,
    shortDescription: t`Default threats for a tenant without a threat feed of its own: threat groups and campaigns derived from MITRE ATT&CK, following its releases.`,
    icon: '/img/icon-opencrq.svg',
    linkOption: connectorLink('default_threats'),
  },
});

export const getConnectorNameBySource = (source: string): string | null =>
  Object.entries(getConnectors()).find(([key]) => key === source)?.[1].name ?? null;

export const getConnectorIconBySource = (source: string): string | null =>
  Object.entries(getConnectors()).find(([key]) => key === source)?.[1].icon ?? null;
