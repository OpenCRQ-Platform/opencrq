import type { AiTargetAssetProperties, AssetObservationProperties, IdentityAssetProperties, MachineAssetProperties } from './types';

const present = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const firstPresent = (...values: ReadonlyArray<string | null | undefined>): string | null =>
  values.map(present).find((value) => value !== null) ?? null;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const compareIpv4 = (a: string, b: string): number => {
  const octetsA = IPV4.exec(a)!.slice(1).map(Number);
  const octetsB = IPV4.exec(b)!.slice(1).map(Number);
  return octetsA.reduce((diff, octet, i) => diff || octet - octetsB[i], 0);
};

const smallest = (values: ReadonlyArray<string>, compare: (a: string, b: string) => number): string | null =>
  values.reduce<string | null>((best, value) => (best === null || compare(value, best) < 0 ? value : best), null);

const lexical = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const formatMac = (mac: string): string => mac.replaceAll(/(.{2})(?!$)/g, '$1:');

/**
 * Smallest in a fixed order so a resync reporting the same addresses in another order keeps the
 * name: IPv4 numerically, else IPv6 lexically, else MAC.
 */
const pickAddress = ({ seenIp, ipAddresses, macAddresses }: MachineAssetProperties): string | null => {
  const ips = ipAddresses.map(present).filter((ip) => ip !== null);
  const mac = smallest(macAddresses.map(present).filter((m) => m !== null), lexical);
  return firstPresent(
    seenIp,
    smallest(ips.filter((ip) => IPV4.test(ip)), compareIpv4),
    smallest(ips.filter((ip) => !IPV4.test(ip)), lexical),
    mac === null ? null : formatMac(mac),
  );
};

/** The vendor is dropped when the model already starts with it ("Apple" + "AppleTV14,1"). */
const hardwareLabel = ({ vendor, model }: MachineAssetProperties): string | null => {
  const vendorText = present(vendor);
  const modelText = present(model);
  if (vendorText !== null && modelText !== null && modelText.toLowerCase().startsWith(vendorText.toLowerCase())) {
    return modelText;
  }
  return [vendorText, modelText].filter((part) => part !== null).join(' ') || null;
};

const deriveMachineName = (properties: MachineAssetProperties): string | null =>
  present(properties.hostname)
  ?? ([hardwareLabel(properties), pickAddress(properties)].filter((part) => part !== null).join(' · ') || null);

const deriveIdentityName = (properties: IdentityAssetProperties): string | null => {
  const accountName = present(properties.accountName);
  const domain = present(properties.accountDomain);
  const account = accountName !== null && domain !== null ? `${domain}\\${accountName}` : accountName;
  return firstPresent(properties.userPrincipalName, account, properties.directoryObjectId, properties.cloudSid, properties.onPremSid);
};

const deriveAiTargetName = (properties: AiTargetAssetProperties): string | null =>
  firstPresent(properties.model, properties.endpointUrl);

/**
 * A readable name for an asset no source named, built from its resolved properties. Pure and
 * order-independent of the address arrays, so recomputing it after a resync never renames the asset.
 */
export const deriveAssetName = (properties: AssetObservationProperties | null): string | null => {
  switch (properties?.family) {
    case 'machine':
      return deriveMachineName(properties);
    case 'identity':
      return deriveIdentityName(properties);
    case 'ai_target':
      return deriveAiTargetName(properties);
    case undefined:
      return null;
  }
};
