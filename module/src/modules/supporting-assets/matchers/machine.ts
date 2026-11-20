import type { AssetObservation, MachineAssetProperties } from '../types';
import { isIpLiteral } from '../normalization';

/**
 * Cross-connector identity for the Machine family, in descending strength, with a veto: a match at
 * a weaker tier is rejected when both sides carry a stronger identifier and those disagree. No
 * confidence score, no threshold, no suggestion queue — what no tier joins stays separate.
 *
 * Modelled on `threat-analyses/identity.ts`: additive registration (`register`) so later
 * observations in the same ingestion batch resolve against earlier ones, and `resolve` never
 * mutates the index.
 */
export interface MachineIdentityIndex {
  /** The canonical asset id this observation belongs to, or undefined for a new machine. */
  resolve: (observation: AssetObservation) => string | undefined,
  register: (assetId: string, observation: AssetObservation) => void,
  /** The tier-0/tier-1 veto, offered to the common tier as well — see `FamilyIdentityIndex`. */
  disagreesWith: (assetId: string, observation: AssetObservation) => boolean,
}

const EMPTY_MACHINE_PROPERTIES: MachineAssetProperties = {
  family: 'machine',
  hostname: null,
  ipAddresses: [],
  macAddresses: [],
  seenIp: null,
  hardwareUuid: null,
  directoryDeviceId: null,
  cloudVmId: null,
  cloudResourceId: null,
  cloudProvider: null,
  cloudNativeType: null,
  cloudRegion: null,
  platform: null,
  arch: null,
  vendor: null,
  model: null,
  operatingSystem: null,
  osVersion: null,
  isEol: null,
  agentExternalReference: null,
  agentExecutorType: null,
};

/** A machine-family observation carrying no properties block reads as one with nothing set — never as a match on shared absence. */
const machineProperties = (observation: AssetObservation): MachineAssetProperties =>
  (observation.properties?.family === 'machine' ? observation.properties : EMPTY_MACHINE_PROPERTIES);

/**
 * OpenAEV names the executor that produced an agent's external reference; the qualification
 * matters because the same field carries a CrowdStrike, SentinelOne or Tanium reference too, and
 * only an MDE-produced one is a Defender machine id. The exact string OpenAEV serves is unconfirmed
 * against a real tenant, so this matches loosely on the executor family rather than one literal.
 */
export const isMdeExecutor = (executorType: string | null): boolean =>
  (executorType ?? '').toLowerCase().includes('mde')
  || (executorType ?? '').toLowerCase().includes('defender');

/** Tier 0's key: the Defender machine id, however each side names it. */
const tier0Key = (observation: AssetObservation): string | null => {
  const props = machineProperties(observation);
  if (observation.source === 'microsoft_graph') {
    return observation.sourceAssetId;
  }
  if (props.agentExternalReference && isMdeExecutor(props.agentExecutorType)) {
    return props.agentExternalReference;
  }
  return null;
};

/**
 * A short hostname (no domain suffix) is not enough for tier 3: two unrelated machines can share
 * one by recycling or coincidence. Neither is a dotted address, which satisfies the same shape
 * while naming a location rather than a machine.
 */
const isFqdn = (hostname: string): boolean => {
  if (isIpLiteral(hostname)) {
    return false;
  }
  const dot = hostname.indexOf('.');
  return dot > 0 && dot < hostname.length - 1;
};

// One entry per tier-1 identifier kind; each is its own key space, never conflated. The order is
// itself the rule: an observation whose kinds point at two different assets resolves onto the one
// its strongest kind names, a hardware uuid outliving a re-enrollment that a cloud id does not.
type Tier1Kind = 'hardwareUuid' | 'directoryDeviceId' | 'cloudVmId' | 'cloudResourceId';
const TIER1_KINDS: ReadonlyArray<Tier1Kind> = ['hardwareUuid', 'directoryDeviceId', 'cloudVmId', 'cloudResourceId'];

// A source that serializes an absent attribute as `""` rather than `null` must not have every
// device sharing that absence collide on it: callers are expected to normalize upstream, but the
// index treats an empty tier-1 value as absent regardless, so it can never join two machines.
const tier1Value = (observation: AssetObservation, kind: Tier1Kind): string | null => {
  const value = machineProperties(observation)[kind];
  return value ? value : null;
};

/**
 * True when the two observations both carry a value for a strong identifier (tier 0 or tier 1)
 * and those values disagree — the veto that protects a weaker-tier match from fusing two machines
 * that merely share a MAC or a hostname.
 */
const strongIdentifiersDisagree = (a: AssetObservation, b: AssetObservation): boolean => {
  const aTier0 = tier0Key(a);
  const bTier0 = tier0Key(b);
  if (aTier0 !== null && bTier0 !== null && aTier0 !== bTier0) {
    return true;
  }
  return TIER1_KINDS.some((kind) => {
    const aValue = tier1Value(a, kind);
    const bValue = tier1Value(b, kind);
    return aValue !== null && bValue !== null && aValue !== bValue;
  });
};

/** Compared on the leading label alone, so a short name and its FQDN never read as a disagreement. */
const shortHostname = (hostname: string | null): string | null => hostname?.split('.')[0] || null;

/**
 * True when both observations name a host and those names differ. A MAC overlap has no
 * corroborating signal of its own, so a shared address — a docking station, a switch, a recycled
 * NIC — would otherwise fuse two machines that announce themselves as different. The platform is
 * not a second half of this veto: as a coarse OS family it agrees too often to catch what the
 * hostname misses, and a family `normalizePlatform` does not know would refuse a merge the MAC and
 * the hostname both support.
 */
const hostnamesDisagree = (a: AssetObservation, b: AssetObservation): boolean => {
  const aHost = shortHostname(machineProperties(a).hostname);
  const bHost = shortHostname(machineProperties(b).hostname);
  return aHost !== null && bHost !== null && aHost !== bHost;
};

export const buildMachineIdentityIndex = (): MachineIdentityIndex => {
  const assetIdByTier0Key = new Map<string, string>();
  const assetIdByTier1Key = new Map<Tier1Kind, Map<string, string>>(TIER1_KINDS.map((kind) => [kind, new Map()]));
  const assetIdsByMac = new Map<string, Array<string>>();
  const assetIdsByHostname = new Map<string, Array<string>>();
  // The observations registered per asset: what a veto or a corroborating overlap is checked against.
  const observationsByAssetId = new Map<string, Array<AssetObservation>>();

  const register: MachineIdentityIndex['register'] = (assetId, observation) => {
    const props = machineProperties(observation);
    const tier0 = tier0Key(observation);
    if (tier0 !== null && !assetIdByTier0Key.has(tier0)) {
      assetIdByTier0Key.set(tier0, assetId);
    }
    for (const kind of TIER1_KINDS) {
      const value = tier1Value(observation, kind);
      const byKind = assetIdByTier1Key.get(kind)!;
      if (value !== null && !byKind.has(value)) {
        byKind.set(value, assetId);
      }
    }
    for (const mac of props.macAddresses) {
      const assetIds = assetIdsByMac.get(mac) ?? [];
      if (!assetIds.includes(assetId)) {
        assetIds.push(assetId);
      }
      assetIdsByMac.set(mac, assetIds);
    }
    if (props.hostname !== null && isFqdn(props.hostname)) {
      const assetIds = assetIdsByHostname.get(props.hostname) ?? [];
      if (!assetIds.includes(assetId)) {
        assetIds.push(assetId);
      }
      assetIdsByHostname.set(props.hostname, assetIds);
    }
    const observations = observationsByAssetId.get(assetId) ?? [];
    observations.push(observation);
    observationsByAssetId.set(assetId, observations);
  };

  const vetoedAgainst = (assetId: string, observation: AssetObservation): boolean =>
    (observationsByAssetId.get(assetId) ?? []).some((candidate) => strongIdentifiersDisagree(observation, candidate));

  /**
   * Tier 1 is weaker than tier 0, so it gets the veto too — restricted to tier 0, since two
   * tier-1 kinds may legitimately disagree on one machine (a re-enrolled device keeps its
   * hardware uuid and gets a new directory id).
   */
  const tier0Disagrees = (assetId: string, observation: AssetObservation): boolean => {
    const tier0 = tier0Key(observation);
    if (tier0 === null) {
      return false;
    }
    return (observationsByAssetId.get(assetId) ?? []).some((candidate) => {
      const candidateTier0 = tier0Key(candidate);
      return candidateTier0 !== null && candidateTier0 !== tier0;
    });
  };

  // A MAC carries no corroboration of its own, so both vetoes apply: the strong one against a
  // disagreeing machine id, the hostname one against a name that says "not me".
  const resolveByMacOverlap = (observation: AssetObservation): string | undefined => {
    for (const mac of machineProperties(observation).macAddresses) {
      for (const assetId of assetIdsByMac.get(mac) ?? []) {
        const candidates = observationsByAssetId.get(assetId) ?? [];
        const disagrees = candidates.some((candidate) =>
          strongIdentifiersDisagree(observation, candidate) || hostnamesDisagree(observation, candidate));
        if (!disagrees) {
          return assetId;
        }
      }
    }
    return undefined;
  };

  // Never a bare hostname and never a bare IP: FQDN equality plus platform agreement plus an
  // overlap on an IP or a MAC — the weakest tier, and the one the veto exists for.
  const resolveByHostname = (observation: AssetObservation): string | undefined => {
    const props = machineProperties(observation);
    if (props.hostname === null || props.platform === null || !isFqdn(props.hostname)) {
      return undefined;
    }
    for (const assetId of assetIdsByHostname.get(props.hostname) ?? []) {
      const candidates = observationsByAssetId.get(assetId) ?? [];
      const platformAgrees = candidates.some((candidate) => machineProperties(candidate).platform === props.platform);
      const addressOverlap = candidates.some((candidate) => {
        const candidateProps = machineProperties(candidate);
        return candidateProps.macAddresses.some((mac) => props.macAddresses.includes(mac))
          || candidateProps.ipAddresses.some((ip) => props.ipAddresses.includes(ip));
      });
      if (platformAgrees && addressOverlap && !vetoedAgainst(assetId, observation)) {
        return assetId;
      }
    }
    return undefined;
  };

  const resolve: MachineIdentityIndex['resolve'] = (observation) => {
    const tier0 = tier0Key(observation);
    if (tier0 !== null) {
      const byTier0 = assetIdByTier0Key.get(tier0);
      if (byTier0 !== undefined) {
        return byTier0;
      }
    }

    for (const kind of TIER1_KINDS) {
      const value = tier1Value(observation, kind);
      if (value !== null) {
        const byTier1 = assetIdByTier1Key.get(kind)!.get(value);
        if (byTier1 !== undefined && !tier0Disagrees(byTier1, observation)) {
          return byTier1;
        }
      }
    }

    return resolveByMacOverlap(observation) ?? resolveByHostname(observation);
  };

  return { resolve, register, disagreesWith: vetoedAgainst };
};
