import type { AssetCriticality, AssetCriticalityRule } from '@app/module';
import { ASSET_CRITICALITY_SEVERITY } from '@app/module';

/**
 * A device's criticality, read from what Defender knows it is and from what the organisation
 * declared, each rule yielding a band.
 *
 * The roles are the six whose compromise is the compromise of an authentication or recovery domain
 * rather than of one workload. A role counts at any detection confidence: the only ones a measured
 * estate detected were at Low, and they were right. A workstation's band from the person it is
 * assigned to is not here: it reads another asset, so a job derives it.
 */

/**
 * Matched on the whole role name, lower-cased and stripped of everything but letters, so that a
 * role merely containing one of these words (an admin's device, say) rates nothing. Microsoft
 * publishes no list: `DomainController` and `ActiveDirectoryCertificateServicesServer` are the
 * names a measured estate returned, the others follow their pattern, and the sync logs every role
 * name no rule matched so that a wrong guess shows. In the order that names a reading on a tie.
 */
const ROLE_RULES: ReadonlyArray<{ rule: AssetCriticalityRule, names: ReadonlySet<string>, criticality: AssetCriticality }> = [
  { rule: 'domain_controller', names: new Set(['domaincontroller']), criticality: 'very_high' },
  { rule: 'certificate_services', names: new Set(['activedirectorycertificateservicesserver', 'adcsserver']), criticality: 'very_high' },
  { rule: 'federation_services', names: new Set(['activedirectoryfederationservicesserver', 'adfsserver']), criticality: 'very_high' },
  { rule: 'entra_connect', names: new Set(['entraconnectserver', 'azureadconnectserver', 'aadconnectserver']), criticality: 'very_high' },
  { rule: 'hypervisor', names: new Set(['hypervserver', 'hypervhost', 'vmwareesxiserver', 'esxiserver', 'vmwarevcenterserver', 'vcenterserver']), criticality: 'high' },
  { rule: 'backup', names: new Set(['backupserver']), criticality: 'high' },
];

const normalizeRole = (role: string): string => role.toLowerCase().replace(/[^a-z]/g, '');

const matchesRole = (role: string): boolean => {
  const name = normalizeRole(role);
  return ROLE_RULES.some(({ names }) => names.has(name));
};

/** `Normal` is Defender's default, never a judgement, so it states nothing, as an empty value does. */
const DECLARED_RULES = new Map<string, { rule: AssetCriticalityRule, criticality: AssetCriticality }>([
  ['veryhigh', { rule: 'asset_value_very_high', criticality: 'very_high' }],
  ['high', { rule: 'asset_value_high', criticality: 'high' }],
  ['low', { rule: 'asset_value_low', criticality: 'low' }],
]);

/**
 * The role names of a `DeviceRoles` value: an object map keyed by role, which Advanced Hunting
 * returns as a JSON string, `{}` or nothing when the device has none.
 */
export const parseDeviceRoles = (value: unknown): Array<string> => {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed) : [];
};

/** The most severe reading the device's roles and declared value yield, and the rule behind it; `unknown` and no rule when none applies. */
export const deviceCriticality = (
  roles: ReadonlyArray<string>,
  assetValue: string,
): { criticality: AssetCriticality, rule: AssetCriticalityRule | null } => {
  const names = roles.map(normalizeRole);
  const declared = DECLARED_RULES.get(assetValue.toLowerCase());
  const candidates = [
    ...ROLE_RULES.filter((rule) => names.some((name) => rule.names.has(name))),
    ...(declared === undefined ? [] : [declared]),
  ];
  return candidates.reduce<{ criticality: AssetCriticality, rule: AssetCriticalityRule | null }>(
    (best, candidate) => (ASSET_CRITICALITY_SEVERITY[candidate.criticality] > ASSET_CRITICALITY_SEVERITY[best.criticality] ? { criticality: candidate.criticality, rule: candidate.rule } : best),
    { criticality: 'unknown', rule: null },
  );
};

/** The distinct role names no rule rates, for the sync to log: a role Defender renamed would otherwise rate nothing silently. */
export const unratedDeviceRoles = (roles: ReadonlyArray<string>): Array<string> =>
  [...new Set(roles.filter((role) => !matchesRole(role)))].sort();
