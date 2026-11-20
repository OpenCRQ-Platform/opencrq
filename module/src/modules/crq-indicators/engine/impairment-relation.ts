import { controlCapabilitiesData } from '../../controls/capability/data/capabilities.generated';

/**
 * Which defensive capability each Defense Impairment technique can take down: the fifth reference
 * table of the attack run engine, and the mirror of the catalogue's anti-tampering edges. Those read
 * "this capability stops this technique"; this reads "this technique, having succeeded, disables
 * that capability", and it was authored without consulting them.
 *
 * A capability is taken down when it is disabled, blinded, bypassed at its enforcement point, or
 * its decisions no longer bind on the affected asset. That last clause is load-bearing and it makes
 * the table deliberately generous: a Defense Impairment technique that takes nothing down does
 * nothing in the engine but emit noise, and there is no other channel for an attacker routing
 * around a control. It is the first thing to re-open if such a channel ever appears.
 *
 * Two failure modes govern an edit. A technique pointed at too many capabilities reinstates the
 * flat sabotage depth this relation replaced, where clearing a Windows event log weakened
 * multi-factor authentication. A technique pointed at none silently removes a mechanism carrying a
 * large share of the reach, which is why {@link takesDown} is empty rather than absent on the six
 * techniques that take nothing down. A knockout lifts everything a capability carries, both
 * functions and every setting it bundles, so a technique names it only when its effect reaches that
 * whole: a stopped cloud audit trail, or an account severed from its organization's ceiling, leaves
 * the security groups and the bucket policies enforcing.
 *
 * The engine plays parent techniques only. A parent row names what the parent's own text takes down;
 * a capability that a single form takes down stays on that sub-technique's row, unread until the
 * engine plays sub-techniques, rather than being lifted to the parent, where every form would take it.
 */

export interface ImpairmentJudgment {
  readonly scope: string,
  /** The ATT&CK release whose techniques this session judged. */
  readonly release: string,
  readonly promptVersion: string,
  readonly model: string,
}

export interface ImpairmentRelationProvenance {
  /** ATT&CK Enterprise release the technique set was drawn from. */
  readonly knowledgeBaseRelease: string,
  readonly generatedAt: string,
  readonly judgments: ReadonlyArray<ImpairmentJudgment>,
}

export const IMPAIRMENT_RELATION_PROVENANCE: ImpairmentRelationProvenance = {
  knowledgeBaseRelease: '20.0',
  generatedAt: '2026-10-29',
  judgments: [
    { scope: 'TA0112 impairment relation', release: '19.2', promptVersion: '1', model: 'claude-opus-5' },
    { scope: 'TA0112 techniques the release added', release: '20.0', promptVersion: '1', model: 'claude-opus-5-5' },
    { scope: 'TA0112 impairment relation against the 51 defense-catalogue controls', release: '20.0', promptVersion: '2', model: 'claude-opus-5-5' },
  ],
};

export interface ImpairmentRelationEntry {
  readonly techniqueExternalId: string,
  /** The technique's ATT&CK name, so a row is reviewable without a lookup and a mistyped id fails. */
  readonly name: string,
  /** Capability external ids of the catalogue. Empty is a judged verdict, never an unwritten row. */
  readonly takesDown: ReadonlyArray<string>,
  /** Why those capabilities and no others, on the same footing as the applicability table. */
  readonly why: string,
}

export const IMPAIRMENT_RELATION: ReadonlyArray<ImpairmentRelationEntry> = [
  {
    techniqueExternalId: 'T1112',
    name: 'Modify Registry',
    takesDown: ['OSH'],
    why: 'the registry holds the security baseline settings (macro policy, elevation prompts, plaintext credential storage)',
  },
  {
    techniqueExternalId: 'T1207',
    name: 'Rogue Domain Controller',
    takesDown: ['SIEM', 'ADH'],
    why: 'changes replicate into the domain without the legitimate domain controller auditing them, and any object the directory hardening rests on (tiering ACLs, policies, keys) is rewritten',
  },
  {
    techniqueExternalId: 'T1222',
    name: 'File and Directory Permissions Modification',
    takesDown: ['OSH'],
    why: 'the tightened file and directory permissions the baseline sets are rewritten by the owner change',
  },
  {
    techniqueExternalId: 'T1222.001',
    name: 'Windows Permissions',
    takesDown: ['OSH'],
    why: '`icacls` and `takeown` rewrite the DACLs that carry the hardened permission posture',
  },
  {
    techniqueExternalId: 'T1222.002',
    name: 'Linux and Mac Permissions',
    takesDown: ['OSH'],
    why: '`chmod` and `chown` rewrite the ownership and mode that carry the hardened permission posture',
  },
  {
    techniqueExternalId: 'T1484',
    name: 'Domain or Tenant Policy Modification',
    takesDown: ['IDP', 'OSH', 'ADH'],
    why: 'trust and federation settings stop binding on the authentication decision, and the domain-distributed baseline is rewritten with the password, Kerberos and audit policies the domain sets',
  },
  {
    techniqueExternalId: 'T1484.001',
    name: 'Group Policy Modification',
    takesDown: ['OSH', 'ADH', 'PAM'],
    why: "the GPO distributes the endpoint baseline and the domain's password, Kerberos and audit policies, and its user rights assignments re-grant standing privileges that tiering and just-in-time elevation had removed",
  },
  {
    techniqueExternalId: 'T1484.002',
    name: 'Trust Modification',
    takesDown: ['IDP', 'ADH'],
    why: 'an attacker-added federated provider mints accepted tokens and a loosened domain trust admits foreign identities, so neither the directory decision nor the second factor is ever reached',
  },
  {
    techniqueExternalId: 'T1553',
    name: 'Subvert Trust Controls',
    takesDown: ['EDR', 'OSH'],
    why: 'execution policy keyed on trust admits the artifact, and the configured trust posture no longer refuses it',
  },
  {
    techniqueExternalId: 'T1553.001',
    name: 'Gatekeeper Bypass',
    takesDown: ['OSH'],
    why: 'the quarantine attribute the macOS trust posture keys on is absent, so the gate never fires',
  },
  {
    techniqueExternalId: 'T1553.002',
    name: 'Code Signing',
    takesDown: ['EDR', 'OSH'],
    why: 'a genuinely valid signature satisfies both allowlisting and the signed-code-only baseline',
  },
  {
    techniqueExternalId: 'T1553.003',
    name: 'SIP and Trust Provider Hijacking',
    takesDown: ['EDR', 'OSH'],
    why: 'signature validation returns success for any file, so application control and the signing policy both accept it',
  },
  {
    techniqueExternalId: 'T1553.004',
    name: 'Install Root Certificate',
    takesDown: ['TLS', 'EDR', 'PKI'],
    why: "the host trusts an attacker chain, so TLS no longer denies readable plaintext, cloned-chain signatures pass validation tools, and the organisation's issuance and revocation no longer decide what the host trusts",
  },
  {
    techniqueExternalId: 'T1553.005',
    name: 'Mark-of-the-Web Bypass',
    takesDown: ['OSH'],
    why: 'the Zone.Identifier tag that Protected View and SmartScreen key on never reaches the extracted file',
  },
  {
    techniqueExternalId: 'T1553.006',
    name: 'Code Signing Policy Modification',
    takesDown: ['OSH', 'EDR'],
    why: 'disabling Driver Signature Enforcement or macOS SIP breaks boot and code integrity and opens kernel-mode tampering under the agent',
  },
  {
    techniqueExternalId: 'T1556',
    name: 'Modify Authentication Process',
    takesDown: ['IDP'],
    why: 'the authentication decision is patched, so a credential need not be valid to resolve into a session',
  },
  {
    techniqueExternalId: 'T1556.001',
    name: 'Domain Controller Authentication',
    takesDown: ['ADH'],
    why: "an injected master password authenticates as any domain account past the directory's password policy, its own text scoping the payoff to single-factor environments, so the second factor still binds",
  },
  {
    techniqueExternalId: 'T1556.002',
    name: 'Password Filter DLL',
    takesDown: [],
    why: 'harvests plaintext at password set time, the policy filters and the authentication decision both still bind',
  },
  {
    techniqueExternalId: 'T1556.003',
    name: 'Pluggable Authentication Modules',
    takesDown: ['IDP'],
    why: 'a patched `pam_unix.so` accepts adversary-supplied values as legitimate credentials',
  },
  {
    techniqueExternalId: 'T1556.004',
    name: 'Network Device Authentication',
    takesDown: ['NDH'],
    why: 'a hard-coded password in the device image grants access ahead of the native authentication check the device baseline configures',
  },
  {
    techniqueExternalId: 'T1556.005',
    name: 'Reversible Encryption',
    takesDown: ['ADH'],
    why: 'the directory hardening that forbids reversible storage is switched off on the account or the domain policy, so credential material stops being irrecoverable',
  },
  {
    techniqueExternalId: 'T1556.006',
    name: 'Multi-Factor Authentication',
    takesDown: ['IDP'],
    why: 'the factor requirement is disabled, excluded, or redirected to a failing endpoint that fails open',
  },
  {
    techniqueExternalId: 'T1556.007',
    name: 'Hybrid Identity',
    takesDown: ['IDP'],
    why: 'a backdoored PTA agent or AD FS host mints tokens for any user with any claims, bypassing the policy and the factor',
  },
  {
    techniqueExternalId: 'T1556.008',
    name: 'Network Provider DLL',
    takesDown: [],
    why: "captures cleartext credentials at logon, no control's enforcement point stops working",
  },
  {
    techniqueExternalId: 'T1556.009',
    name: 'Conditional Access Policies',
    takesDown: ['IDP'],
    why: 'the policy carrying the context conditions and the factor requirement is edited at the point that imposes it',
  },
  {
    techniqueExternalId: 'T1578',
    name: 'Modify Cloud Compute Infrastructure',
    takesDown: ['CWPP'],
    why: 'deleting or reverting instances destroys the workload agent and its unforwarded evidence, while escaping restrictions through a new instance or snapshot takes nothing down',
  },
  {
    techniqueExternalId: 'T1578.001',
    name: 'Create Snapshot',
    takesDown: [],
    why: 'an entitled control-plane copy, the permissive reach into the mount comes from a separate firewall change',
  },
  {
    techniqueExternalId: 'T1578.002',
    name: 'Create Cloud Instance',
    takesDown: [],
    why: 'escapes the policies attached to existing instances by standing up a new asset, nothing on the old ones stops working',
  },
  {
    techniqueExternalId: 'T1578.003',
    name: 'Delete Cloud Instance',
    takesDown: ['CWPP'],
    why: 'the agent and its unforwarded host telemetry vanish with the instance, while the cloud audit trail still records the deletion',
  },
  {
    techniqueExternalId: 'T1578.004',
    name: 'Revert Cloud Instance',
    takesDown: ['CWPP'],
    why: "rolling the disk back to a snapshot removes on-disk artifacts and the agent's local state",
  },
  {
    techniqueExternalId: 'T1578.005',
    name: 'Modify Cloud Compute Configurations',
    takesDown: [],
    why: 'quotas, tenant-wide policies and region enablement are one native setting each, the rest of the cloud baseline keeps enforcing and the posture tool reports the change',
  },
  {
    techniqueExternalId: 'T1599',
    name: 'Network Boundary Bridging',
    takesDown: ['NGFW', 'IPS'],
    why: 'control of the boundary device passes prohibited traffic across the trust boundary and around its deep packet inspection',
  },
  {
    techniqueExternalId: 'T1599.001',
    name: 'Network Address Translation Traversal',
    takesDown: ['NGFW'],
    why: 'rewritten translation carries packets between networks the routing policy separates',
  },
  {
    techniqueExternalId: 'T1600',
    name: 'Weaken Encryption',
    takesDown: ['TLS'],
    why: "the device's ability to encrypt transmitted traffic is the thing compromised",
  },
  {
    techniqueExternalId: 'T1600.001',
    name: 'Reduce Key Space',
    takesDown: ['TLS'],
    why: 'the cipher strength that made interception unprofitable is cut to a trivially breakable key',
  },
  {
    techniqueExternalId: 'T1600.002',
    name: 'Disable Crypto Hardware',
    takesDown: ['TLS'],
    why: 'the dedicated encryption hardware that holds the key material and resists tampering is switched off',
  },
  {
    techniqueExternalId: 'T1601',
    name: 'Modify System Image',
    takesDown: ['NGFW', 'TLS', 'NDH'],
    why: "the device's policy enforcement, its crypto and its authentication all run inside the single file being replaced, whose integrity the device baseline guards",
  },
  {
    techniqueExternalId: 'T1601.001',
    name: 'Patch System Image',
    takesDown: ['NGFW', 'TLS', 'NDH'],
    why: 'its own text names the impeded defenses as perimeter enforcement, encryption and authentication, and the patched image is no longer the one the baseline verified',
  },
  {
    techniqueExternalId: 'T1601.002',
    name: 'Downgrade System Image',
    takesDown: ['TLS', 'NDH'],
    why: 'an older image reinstates weaker ciphers on the traffic the device protects and is no longer the image the baseline verified',
  },
  {
    techniqueExternalId: 'T1647',
    name: 'Plist File Modification',
    takesDown: ['OSH'],
    why: 'the configuration-tampering branch alone: a plist carrying a baseline setting is rewritten, so the baseline stops binding on that machine. Persistence and window hiding do not count',
  },
  {
    techniqueExternalId: 'T1666',
    name: 'Modify Cloud Resource Hierarchy',
    takesDown: ['CNAPP', 'SIEM'],
    why: "severing or transferring an account takes it out of the organization-level posture connector and moves the victim tenant's audit records, while its own security groups and bucket policies keep enforcing",
  },
  {
    techniqueExternalId: 'T1685',
    name: 'Disable or Modify Tools',
    takesDown: ['EDR', 'SIEM', 'FIM', 'CWPP', 'DAM'],
    why: 'the security agents on the held assets (endpoint, file integrity, workload, database) are stopped, and the record producers and forwarders feeding correlation are cut at the source',
  },
  {
    techniqueExternalId: 'T1685.001',
    name: 'Disable or Modify Windows Event Log',
    takesDown: ['SIEM'],
    why: 'the EventLog service and audit policy stop producing the records that are onboarded',
  },
  {
    techniqueExternalId: 'T1685.002',
    name: 'Disable or Modify Cloud Log',
    takesDown: ['SIEM', 'CNAPP'],
    why: 'the cloud audit trail stops being written, which is both the onboarded feed and the telemetry the posture detect leg reads',
  },
  {
    techniqueExternalId: 'T1685.003',
    name: 'Modify or Spoof Tool UI',
    takesDown: [],
    why: "falsifies the operator's view of status, the controls it fronts were already disabled by another technique",
  },
  {
    techniqueExternalId: 'T1685.004',
    name: 'Disable or Modify Linux Audit System Log',
    takesDown: ['SIEM'],
    why: '`auditd` is stopped, its rules edited, or its library functions hooked, so kernel-level records stop being emitted',
  },
  {
    techniqueExternalId: 'T1685.005',
    name: 'Clear Windows Event Logs',
    takesDown: ['SIEM'],
    why: 'the records are destroyed before correlation can see them, and post-reboot logging stops',
  },
  {
    techniqueExternalId: 'T1685.006',
    name: 'Clear Linux or Mac System Logs',
    takesDown: ['SIEM'],
    why: 'the authentication, login and system records under `/var/log/` are deleted before forwarding',
  },
  {
    techniqueExternalId: 'T1685.007',
    name: 'Impair Autonomous Defenses',
    takesDown: ['EDR', 'SIEM', 'SOC', 'MDR'],
    why: 'a model in the artifact or alert path aborts or clears what it was given, so the endpoint verdict on the malware, the alert on the activity and the response hanging on it no longer fire',
  },
  {
    techniqueExternalId: 'T1686',
    name: 'Disable or Modify System Firewall',
    takesDown: ['NGFW', 'MSEG'],
    why: 'firewall services, profiles and rule sets are the boundary enforcement itself, and they carry the host rules the segmentation agent programs',
  },
  {
    techniqueExternalId: 'T1686.001',
    name: 'Cloud Firewall',
    takesDown: ['NGFW'],
    why: 'new ingress rules and security groups reopen the boundary the cloud security group enforced',
  },
  {
    techniqueExternalId: 'T1686.002',
    name: 'Network Device Firewall',
    takesDown: ['NGFW'],
    why: 'ACLs, zones and policy rules on the device are edited to permit blocked traffic',
  },
  {
    techniqueExternalId: 'T1686.003',
    name: 'Windows Host Firewall',
    takesDown: ['NGFW', 'MSEG'],
    why: "the host firewall profiles and rules are disabled or rewritten, the segmentation agent's among them, and nothing else on the host is touched",
  },
  {
    techniqueExternalId: 'T1687',
    name: 'Exploitation for Defense Impairment',
    takesDown: ['EDR', 'NGFW', 'SIEM'],
    why: 'exploiting the defensive component itself terminates the agent, disables enforcement, or kills the monitoring feed',
  },
  {
    techniqueExternalId: 'T1688',
    name: 'Safe Mode Boot',
    takesDown: ['EDR'],
    why: 'third-party endpoint agents are not among the limited set of services a safe mode boot starts',
  },
  {
    techniqueExternalId: 'T1689',
    name: 'Downgrade Attack',
    takesDown: ['OSH', 'TLS', 'SIEM'],
    why: 'a Secure Boot bypass breaks boot integrity, HTTPS is stripped to HTTP, and an older PowerShell emits no script block records',
  },
  {
    techniqueExternalId: 'T1690',
    name: 'Prevent Command History Logging',
    takesDown: ['SIEM'],
    why: 'the shell and PSReadLine history stop being written, on the assumption that those artifacts are onboarded; the network device branch plays where SIEM is not declared in force',
  },
];

const TAKES_DOWN_BY_TECHNIQUE = new Map(
  IMPAIRMENT_RELATION.map((entry) => [entry.techniqueExternalId, entry.takesDown]),
);

/**
 * `targets(T)` of the law: the capabilities technique `T` can disable. Empty for every technique
 * outside the relation, which is the same answer as a declared empty row and the correct one:
 * a technique that is not Defense Impairment takes nothing down.
 */
export const capabilitiesTakenDownBy = (techniqueExternalId: string): ReadonlyArray<string> =>
  TAKES_DOWN_BY_TECHNIQUE.get(techniqueExternalId) ?? [];

const CATALOGUE_CAPABILITY_EXTERNAL_IDS = new Set(controlCapabilitiesData.map((capability) => capability.externalId));

/**
 * The capability external ids the relation cites that the catalogue does not carry. Never non-empty
 * at runtime without the build having failed first: the co-located test asserts it is empty,
 * because a row naming an unknown capability knocks nothing out and the sabotage it represents
 * silently disappears.
 */
export const UNRESOLVED_IMPAIRMENT_CAPABILITY_EXTERNAL_IDS: ReadonlyArray<string> = [...new Set(
  IMPAIRMENT_RELATION.flatMap((entry) => entry.takesDown).filter((externalId) => !CATALOGUE_CAPABILITY_EXTERNAL_IDS.has(externalId)),
)].sort();
