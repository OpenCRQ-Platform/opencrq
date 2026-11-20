/**
 * The demo threats of the Acme tenant, emitted as a STIX 2.1 bundle in the shapes
 * `parseThreatBundle` accepts. The seed hands the bundle to that parser instead of writing
 * analysis rows of its own, so a demo actor can carry nothing the platform would not accept from an
 * uploaded bundle, and is dated from the run so its activity windows are never stale.
 */

const TECHNIQUE_NAMES: Record<string, string> = {
  T1003: 'OS Credential Dumping',
  T1005: 'Data from Local System',
  T1027: 'Obfuscated Files or Information',
  T1039: 'Data from Network Shared Drive',
  T1040: 'Network Sniffing',
  T1041: 'Exfiltration Over C2 Channel',
  T1048: 'Exfiltration Over Alternative Protocol',
  T1070: 'Indicator Removal',
  T1078: 'Valid Accounts',
  T1110: 'Brute Force',
  T1114: 'Email Collection',
  T1133: 'External Remote Services',
  T1213: 'Data from Information Repositories',
  T1485: 'Data Destruction',
  T1486: 'Data Encrypted for Impact',
  T1489: 'Service Stop',
  T1490: 'Inhibit System Recovery',
  T1495: 'Firmware Corruption',
  T1529: 'System Shutdown/Reboot',
  T1539: 'Steal Web Session Cookie',
  T1555: 'Credentials from Password Stores',
  T1557: 'Adversary-in-the-Middle',
  T1558: 'Steal or Forge Kerberos Tickets',
  T1560: 'Archive Collected Data',
  T1561: 'Disk Wipe',
  T1565: 'Data Manipulation',
  T1567: 'Exfiltration Over Web Service',
  T1621: 'Multi-Factor Authentication Request Generation',
  T1566: 'Phishing',
  T1190: 'Exploit Public-Facing Application',
  T1059: 'Command and Scripting Interpreter',
  T1547: 'Boot or Logon Autostart Execution',
  T1068: 'Exploitation for Privilege Escalation',
  T1562: 'Impair Defenses',
  T1018: 'Remote System Discovery',
  T1082: 'System Information Discovery',
  T1021: 'Remote Services',
  T1570: 'Lateral Tool Transfer',
  T1071: 'Application Layer Protocol',
  T1105: 'Ingress Tool Transfer',
  T1098: 'Account Manipulation',
  T1111: 'Multi-Factor Authentication Interception',
  T1656: 'Impersonation',
  T1657: 'Financial Theft',
};

/**
 * Routine tradecraft added to the techniques the write-ups name. A write-up names what made the
 * actor distinctive, the terminal techniques, and the attack run engine walks the whole chain: an
 * actor holding only terminal techniques cannot play any obstacle before the objective.
 */
const WALK_BACKBONE_EXTERNAL_IDS = [
  'T1566', 'T1190', 'T1059', 'T1547', 'T1068', 'T1562', 'T1018', 'T1082', 'T1021', 'T1570', 'T1071', 'T1105',
] as const;

interface ChildEvent {
  days: number,
  confidence: number,
  // Defaulted to the demo feed's single producer when omitted, set explicitly to demonstrate two
  // producers stating the same claim about one target.
  producerStixId?: string,
  producerName?: string,
  isInferred?: boolean,
}

const DEFAULT_PRODUCER_STIX_ID = 'identity--seed-producer-demo-feed';
const DEFAULT_PRODUCER_NAME = 'Demo Intel Feed';
const SECOND_PRODUCER_STIX_ID = 'identity--seed-producer-partner-feed';
const SECOND_PRODUCER_NAME = 'Partner Intel Feed';

/**
 * Grade of every temporal anchor the actor's relationships carry.
 *
 * `observed`: the relationships carry an activity window (`start_time`), so the anchor resolves
 * observed and the mixture decays it on the short half-life (180 days by default).
 * `authored`: the relationships carry only the intelligence creation date (no `start_time`, and
 * neither `first_seen` nor `last_seen` on the parent, either of which grades observed on its own),
 * so the anchor resolves authored and decays on the long half-life (365 days). This is what real
 * MITRE-style `uses` relations look like, so the demo tenant must exercise it: seeding every actor
 * as observed made the provenance split permanently dead code in dev and permanently live in demos,
 * which is exactly backwards.
 */
type AnchorGrade = 'observed' | 'authored';

interface ActorSpec {
  slug: string,
  entityType?: 'threat-actor' | 'campaign',
  name: string,
  aliases: Array<string>,
  // Left undefined (defaulting to none) by every existing actor: the declared-motivation and goal
  // cases are seeded separately rather than reworking every entry above.
  secondaryMotivations?: Array<string>,
  goals?: Array<string>,
  anchorGrade: AnchorGrade,
  description: string,
  mitreGroupId: string | null,
  confidence: number,
  firstSeenDaysAgo: number,
  lastSeenDaysAgo: number,
  // Nullable so one actor can exercise the "nothing declared at all" case; every other actor
  // sets it, as STIX `primary_motivation` usually is.
  primaryMotivation: string | null,
  // Nullable for the same reason: the attack outcome overview's threat distribution needs at
  // least one matching actor with nothing stated for this field too.
  resourceLevel: string | null,
  labels?: Array<string>,
  sophistication?: string,
  threatActorTypes?: Array<string>,
  roles?: Array<string>,
  objective?: string,
  attributedTo?: Array<{ slug: string } & ChildEvent>,
  /**
   * Whether the actor also holds the routine tradecraft of `WALK_BACKBONE_EXTERNAL_IDS`. Off for
   * the actors whose exact claim set a demo case pins: the gated claim, the actor with nothing
   * stated, the declared-motivation cases.
   */
  walkBackbone?: boolean,
  locations: Array<{ name: string, country: string | null } & ChildEvent>,
  sectors: Array<{ name: string } & ChildEvent>,
  cves: Array<{ cveId: string } & ChildEvent>,
  techniques: Array<{ ext: string } & ChildEvent>,
}

const USA = 'United States of America';
const UK = 'United Kingdom of Great Britain and Northern Ireland';

const ACTOR_SPECS: Array<ActorSpec> = [
  {
    slug: 'salt-typhoon',
    name: 'Salt Typhoon',
    aliases: ['GhostEmperor', 'Earth Estries', 'FamousSparrow', 'UNC2286'],
    anchorGrade: 'observed',
    description: 'Chinese state-sponsored espionage group focused on long-dwell compromise of telecommunications and network backbone infrastructure to intercept communications, call records and lawful-intercept systems.',
    mitreGroupId: 'G1045',
    confidence: 85,
    firstSeenDaysAgo: 1500,
    lastSeenDaysAgo: 4,
    primaryMotivation: 'dominance',
    resourceLevel: 'government',
    locations: [
      { name: USA, country: USA, days: 11, confidence: 85 },
      // Same target as above, stated independently by a second producer: two rows, one statement.
      { name: USA, country: USA, days: 13, confidence: 80, producerStixId: SECOND_PRODUCER_STIX_ID, producerName: SECOND_PRODUCER_NAME },
      { name: 'France', country: 'France', days: 47, confidence: 75, isInferred: true },
      { name: 'Singapore', country: 'Singapore', days: 63, confidence: 70 },
    ],
    sectors: [
      { name: 'Telecommunications', days: 18, confidence: 90 },
      { name: 'Finance', days: 26, confidence: 75 },
      { name: 'Government and administrations', days: 85, confidence: 80 },
    ],
    cves: [
      { cveId: 'CVE-2024-21762', days: 7, confidence: 80 },
      { cveId: 'CVE-2023-46805', days: 19, confidence: 75 },
      { cveId: 'CVE-2021-26855', days: 33, confidence: 85 },
    ],
    techniques: [
      // Below the gate (60) and more recent than every other claim on this actor: reading it would
      // move the activity anchor, and the demo exists to prove that it does not.
      { ext: 'T1027', days: 1, confidence: 30 },
      { ext: 'T1557', days: 4, confidence: 85 },
      { ext: 'T1040', days: 9, confidence: 90 },
      { ext: 'T1114', days: 15, confidence: 80 },
      { ext: 'T1005', days: 22, confidence: 70 },
      { ext: 'T1070', days: 31, confidence: 65 },
      { ext: 'T1133', days: 40, confidence: 75 },
      { ext: 'T1213', days: 55, confidence: 60 },
    ],
  },
  {
    slug: 'scattered-spider',
    walkBackbone: true,
    name: 'Scattered Spider',
    aliases: ['UNC3944', 'Octo Tempest', 'Muddled Libra', 'Scatter Swine'],
    anchorGrade: 'observed',
    description: 'Financially motivated group specialized in social engineering of help desks, MFA fatigue and SIM swapping to hijack identities, then rapid lateral movement to data theft and extortion.',
    mitreGroupId: 'G1015',
    confidence: 80,
    firstSeenDaysAgo: 1100,
    lastSeenDaysAgo: 6,
    primaryMotivation: 'personal-gain',
    resourceLevel: 'organization',
    labels: ['extortion'],
    locations: [
      { name: USA, country: USA, days: 13, confidence: 85 },
      { name: UK, country: UK, days: 29, confidence: 75 },
    ],
    sectors: [
      { name: 'Finance', days: 10, confidence: 85 },
      { name: 'Technologies', days: 37, confidence: 80 },
      { name: 'Hospitality', days: 52, confidence: 70 },
    ],
    cves: [
      { cveId: 'CVE-2023-4966', days: 21, confidence: 75 },
    ],
    techniques: [
      { ext: 'T1110', days: 6, confidence: 75 },
      { ext: 'T1003', days: 14, confidence: 80 },
      { ext: 'T1555', days: 24, confidence: 70 },
      { ext: 'T1621', days: 35, confidence: 85 },
      { ext: 'T1539', days: 44, confidence: 65 },
      { ext: 'T1078', days: 58, confidence: 70 },
    ],
  },
  {
    slug: 'alphv-blackcat',
    walkBackbone: true,
    name: 'ALPHV (BlackCat)',
    // Aliases must not collide with Scattered Spider's `UNC3944`: the attacker mixture clusters on a
    // shared alias, so the ransomware brand and the affiliate would count as one group in a risk
    // figure the demo is meant to show as two.
    aliases: ['BlackCat', 'Noberus', 'ALPHV-ng'],
    anchorGrade: 'observed',
    description: 'Ransomware-as-a-service operation running double extortion campaigns: data exfiltration to a leak site followed by Rust-based encryption of Windows and Linux estates.',
    mitreGroupId: null,
    confidence: 75,
    firstSeenDaysAgo: 1200,
    lastSeenDaysAgo: 9,
    primaryMotivation: 'personal-gain',
    resourceLevel: 'organization',
    labels: ['ransomware'],
    locations: [
      { name: USA, country: USA, days: 16, confidence: 80 },
      { name: 'Germany', country: 'Germany', days: 41, confidence: 70 },
    ],
    sectors: [
      { name: 'Finance', days: 23, confidence: 75 },
      { name: 'Health', days: 61, confidence: 80 },
    ],
    cves: [
      { cveId: 'CVE-2021-44228', days: 34, confidence: 75 },
      { cveId: 'CVE-2022-26134', days: 50, confidence: 70 },
    ],
    techniques: [
      { ext: 'T1486', days: 9, confidence: 90 },
      { ext: 'T1490', days: 17, confidence: 85 },
      { ext: 'T1489', days: 28, confidence: 70 },
      { ext: 'T1048', days: 39, confidence: 60 },
      { ext: 'T1567', days: 66, confidence: 65 },
    ],
  },
  {
    slug: 'lockbit',
    walkBackbone: true,
    name: 'LockBit',
    aliases: ['Bitwise Spider', 'ABCD ransomware', 'LockBit Black'],
    anchorGrade: 'observed',
    description: 'Most prolific ransomware-as-a-service franchise, mass-exploiting edge appliances for initial access, disabling recovery, then encrypting and extorting victims across every sector.',
    mitreGroupId: null,
    confidence: 80,
    firstSeenDaysAgo: 1800,
    lastSeenDaysAgo: 3,
    primaryMotivation: 'personal-gain',
    resourceLevel: 'organization',
    labels: ['ransomware'],
    locations: [
      { name: 'France', country: 'France', days: 8, confidence: 80 },
      { name: USA, country: USA, days: 20, confidence: 85 },
      { name: 'Germany', country: 'Germany', days: 36, confidence: 70 },
    ],
    sectors: [
      { name: 'Finance', days: 12, confidence: 80 },
      { name: 'Manufacturing', days: 30, confidence: 75 },
      { name: 'Logistics', days: 49, confidence: 65 },
    ],
    cves: [
      { cveId: 'CVE-2023-3519', days: 15, confidence: 75 },
      { cveId: 'CVE-2018-13379', days: 27, confidence: 80 },
      { cveId: 'CVE-2023-4966', days: 42, confidence: 85 },
    ],
    techniques: [
      { ext: 'T1486', days: 3, confidence: 95 },
      { ext: 'T1490', days: 11, confidence: 90 },
      { ext: 'T1489', days: 25, confidence: 75 },
      { ext: 'T1567', days: 54, confidence: 60 },
      { ext: 'T1110', days: 68, confidence: 65 },
    ],
  },
  {
    slug: 'volt-typhoon',
    walkBackbone: true,
    name: 'Volt Typhoon',
    aliases: ['BRONZE SILHOUETTE', 'Vanguard Panda', 'Insidious Taurus'],
    anchorGrade: 'observed',
    description: 'Chinese state-sponsored group pre-positioning in critical infrastructure through living-off-the-land techniques, maintaining quiet persistence to enable future disruptive operations.',
    mitreGroupId: 'G1017',
    confidence: 85,
    firstSeenDaysAgo: 1300,
    lastSeenDaysAgo: 12,
    primaryMotivation: 'dominance',
    resourceLevel: 'government',
    locations: [
      { name: USA, country: USA, days: 14, confidence: 90 },
      { name: 'Singapore', country: 'Singapore', days: 57, confidence: 65 },
    ],
    sectors: [
      { name: 'Energy', days: 21, confidence: 85 },
      { name: 'Telecommunications', days: 38, confidence: 80 },
      { name: 'Transport', days: 74, confidence: 70 },
    ],
    cves: [
      { cveId: 'CVE-2024-21762', days: 18, confidence: 70 },
      { cveId: 'CVE-2018-13379', days: 32, confidence: 75 },
    ],
    techniques: [
      { ext: 'T1565', days: 12, confidence: 70 },
      { ext: 'T1489', days: 26, confidence: 60 },
      { ext: 'T1040', days: 43, confidence: 75 },
      { ext: 'T1078', days: 59, confidence: 80 },
      { ext: 'T1133', days: 81, confidence: 70 },
    ],
  },
  {
    slug: 'apt28',
    walkBackbone: true,
    name: 'APT28 (Fancy Bear)',
    aliases: ['Fancy Bear', 'Sofacy', 'Sednit', 'Forest Blizzard'],
    anchorGrade: 'authored',
    description: 'Russian military intelligence (GRU) unit conducting credential harvesting, spearphishing and brute-force campaigns against governments, defense and financial entities in NATO countries.',
    mitreGroupId: 'G0007',
    confidence: 90,
    firstSeenDaysAgo: 4000,
    lastSeenDaysAgo: 110,
    primaryMotivation: 'dominance',
    resourceLevel: 'government',
    locations: [
      { name: 'France', country: 'France', days: 118, confidence: 85 },
      { name: 'Germany', country: 'Germany', days: 150, confidence: 80 },
      { name: USA, country: USA, days: 200, confidence: 85 },
    ],
    sectors: [
      { name: 'Government and administrations', days: 125, confidence: 90 },
      { name: 'Defense', days: 170, confidence: 85 },
      { name: 'Finance', days: 240, confidence: 70 },
    ],
    cves: [
      { cveId: 'CVE-2023-23397', days: 130, confidence: 90 },
    ],
    techniques: [
      { ext: 'T1110', days: 110, confidence: 80 },
      { ext: 'T1003', days: 145, confidence: 85 },
      { ext: 'T1558', days: 190, confidence: 70 },
      { ext: 'T1040', days: 230, confidence: 65 },
      { ext: 'T1078', days: 300, confidence: 70 },
    ],
  },
  {
    slug: 'apt29',
    walkBackbone: true,
    name: 'APT29 (Cozy Bear)',
    aliases: ['Cozy Bear', 'The Dukes', 'Midnight Blizzard', 'Nobelium'],
    anchorGrade: 'authored',
    description: 'Russian foreign intelligence (SVR) group running stealthy long-term espionage against diplomatic and government targets, cloud-first tradecraft and supply chain compromise.',
    mitreGroupId: 'G0016',
    confidence: 90,
    firstSeenDaysAgo: 4200,
    lastSeenDaysAgo: 130,
    primaryMotivation: 'dominance',
    // A secondary motivation stated beside the primary one.
    secondaryMotivations: ['espionage'],
    resourceLevel: 'government',
    locations: [
      { name: USA, country: USA, days: 135, confidence: 90 },
      { name: 'Germany', country: 'Germany', days: 180, confidence: 75 },
      { name: 'France', country: 'France', days: 260, confidence: 70 },
    ],
    sectors: [
      { name: 'Government and administrations', days: 140, confidence: 90 },
      { name: 'Diplomacy', days: 200, confidence: 85 },
      { name: 'Finance', days: 330, confidence: 60 },
    ],
    cves: [
      { cveId: 'CVE-2019-19781', days: 160, confidence: 80 },
    ],
    techniques: [
      { ext: 'T1213', days: 130, confidence: 80 },
      { ext: 'T1114', days: 155, confidence: 75 },
      { ext: 'T1048', days: 210, confidence: 60 },
      { ext: 'T1567', days: 280, confidence: 65 },
      { ext: 'T1078', days: 350, confidence: 70 },
    ],
  },
  {
    slug: 'fin7',
    walkBackbone: true,
    name: 'FIN7',
    aliases: ['Carbanak', 'Carbon Spider', 'Sangria Tempest'],
    anchorGrade: 'authored',
    description: 'Financially motivated group historically focused on payment card data theft from finance, hospitality and retail, now diversified into ransomware affiliate operations.',
    mitreGroupId: 'G0046',
    confidence: 80,
    firstSeenDaysAgo: 3500,
    lastSeenDaysAgo: 100,
    primaryMotivation: 'personal-gain',
    resourceLevel: 'organization',
    labels: ['cybercrime'],
    locations: [
      { name: USA, country: USA, days: 105, confidence: 85 },
      { name: UK, country: UK, days: 210, confidence: 70 },
    ],
    sectors: [
      { name: 'Finance', days: 112, confidence: 85 },
      { name: 'Hospitality', days: 185, confidence: 80 },
      { name: 'Culture and entertainment', days: 290, confidence: 60 },
    ],
    cves: [
      { cveId: 'CVE-2021-26855', days: 140, confidence: 70 },
    ],
    techniques: [
      { ext: 'T1041', days: 100, confidence: 80 },
      { ext: 'T1567', days: 150, confidence: 70 },
      { ext: 'T1005', days: 220, confidence: 65 },
      { ext: 'T1560', days: 310, confidence: 60 },
    ],
  },
  {
    slug: 'lazarus',
    walkBackbone: true,
    name: 'Lazarus Group',
    aliases: ['Hidden Cobra', 'Labyrinth Chollima', 'Diamond Sleet'],
    anchorGrade: 'authored',
    description: 'North Korean state-sponsored group blending revenue-generating heists against banks and crypto platforms with destructive retaliation campaigns.',
    mitreGroupId: 'G0032',
    confidence: 85,
    firstSeenDaysAgo: 4500,
    lastSeenDaysAgo: 95,
    primaryMotivation: 'organizational-gain',
    // A word the list carries but that maps to no outcome: recognised, scores nothing.
    goals: ['ideology'],
    resourceLevel: 'government',
    locations: [
      { name: USA, country: USA, days: 100, confidence: 80 },
      { name: 'Singapore', country: 'Singapore', days: 170, confidence: 75 },
    ],
    sectors: [
      { name: 'Finance', days: 98, confidence: 90 },
      { name: 'Technologies', days: 230, confidence: 70 },
    ],
    cves: [
      { cveId: 'CVE-2021-44228', days: 120, confidence: 85 },
      { cveId: 'CVE-2020-1472', days: 250, confidence: 70 },
    ],
    techniques: [
      { ext: 'T1048', days: 95, confidence: 80 },
      { ext: 'T1485', days: 160, confidence: 70 },
      { ext: 'T1561', days: 240, confidence: 65 },
      { ext: 'T1041', days: 320, confidence: 60 },
    ],
  },
  {
    slug: 'sandworm',
    walkBackbone: true,
    name: 'Sandworm Team',
    aliases: ['Voodoo Bear', 'Seashell Blizzard', 'IRIDIUM', 'TeleBots'],
    anchorGrade: 'authored',
    description: 'Russian military intelligence (GRU) unit behind the most destructive cyber attacks on record, wiper deployments and attacks against energy grids and transport infrastructure.',
    mitreGroupId: 'G0034',
    confidence: 90,
    firstSeenDaysAgo: 4800,
    lastSeenDaysAgo: 420,
    primaryMotivation: 'dominance',
    // Free text a source would plausibly write.
    goals: ['Disrupt regional power grid operations for as long as possible'],
    resourceLevel: 'government',
    locations: [
      { name: 'France', country: 'France', days: 430, confidence: 75 },
      { name: 'Germany', country: 'Germany', days: 520, confidence: 70 },
    ],
    sectors: [
      { name: 'Energy', days: 440, confidence: 90 },
      { name: 'Government and administrations', days: 500, confidence: 80 },
      { name: 'Transport', days: 600, confidence: 75 },
    ],
    cves: [
      { cveId: 'CVE-2020-1472', days: 460, confidence: 75 },
    ],
    techniques: [
      { ext: 'T1485', days: 420, confidence: 90 },
      { ext: 'T1561', days: 480, confidence: 85 },
      { ext: 'T1495', days: 560, confidence: 75 },
      { ext: 'T1490', days: 640, confidence: 70 },
      { ext: 'T1529', days: 700, confidence: 65 },
    ],
  },
  {
    slug: 'apt41',
    walkBackbone: true,
    name: 'APT41',
    aliases: ['Winnti', 'BARIUM', 'Wicked Panda', 'Brass Typhoon'],
    anchorGrade: 'authored',
    description: 'Chinese state-sponsored group unusual for combining espionage tasking with financially motivated intrusions, historically exploiting internet-facing applications at scale.',
    mitreGroupId: 'G0096',
    confidence: 85,
    firstSeenDaysAgo: 4000,
    lastSeenDaysAgo: 400,
    primaryMotivation: 'organizational-gain',
    resourceLevel: 'government',
    locations: [
      { name: USA, country: USA, days: 410, confidence: 80 },
      { name: 'France', country: 'France', days: 490, confidence: 70 },
      { name: 'Singapore', country: 'Singapore', days: 580, confidence: 75 },
    ],
    sectors: [
      { name: 'Health', days: 420, confidence: 80 },
      { name: 'Technologies', days: 470, confidence: 85 },
      { name: 'Finance', days: 550, confidence: 70 },
    ],
    cves: [
      { cveId: 'CVE-2021-44228', days: 430, confidence: 85 },
      { cveId: 'CVE-2019-19781', days: 610, confidence: 80 },
    ],
    techniques: [
      { ext: 'T1213', days: 400, confidence: 75 },
      { ext: 'T1005', days: 450, confidence: 70 },
      { ext: 'T1114', days: 530, confidence: 65 },
      { ext: 'T1039', days: 620, confidence: 60 },
    ],
  },
  {
    slug: 'phantom-locker',
    name: 'PhantomLocker',
    aliases: ['GhostVault'],
    anchorGrade: 'observed',
    description: 'Emerging ransomware operation with no observed targeting yet; only its own declared aim names what it is after.',
    mitreGroupId: null,
    confidence: 60,
    firstSeenDaysAgo: 200,
    lastSeenDaysAgo: 5,
    // `ransomware` is a certain match on the Ransomware outcome, and the whole point of this actor is
    // that this declaration, alone, is what admits it: no location, no sector, no signature (or
    // any) technique claim behind it at all.
    primaryMotivation: 'ransomware',
    resourceLevel: 'organization',
    locations: [],
    sectors: [],
    cves: [],
    techniques: [],
  },
  {
    slug: 'hollow-tide',
    name: 'HollowTide',
    aliases: [],
    anchorGrade: 'observed',
    description: 'Ransomware crew observed only in Brazil and only against manufacturing, whose sources describe its cause rather than its aim.',
    mitreGroupId: null,
    confidence: 70,
    firstSeenDaysAgo: 260,
    lastSeenDaysAgo: 12,
    // The mirror image of PhantomLocker: `ideology` points at no outcome, and no seeded country or
    // sector is one the demo organizations carry, so the single signature technique below is the only
    // thing that can list this actor.
    primaryMotivation: 'ideology',
    resourceLevel: 'organization',
    locations: [
      { name: 'Brazil', country: 'Brazil', days: 14, confidence: 75 },
    ],
    sectors: [
      { name: 'Manufacturing', days: 20, confidence: 70 },
    ],
    cves: [],
    techniques: [
      { ext: 'T1486', days: 12, confidence: 80 },
    ],
  },
  {
    slug: 'unc-drift',
    name: 'UNC-Drift',
    aliases: [],
    anchorGrade: 'observed',
    description: 'Newly clustered activity, tracked by its infrastructure alone; no source has yet reported what it is after.',
    mitreGroupId: null,
    confidence: 40,
    firstSeenDaysAgo: 90,
    lastSeenDaysAgo: 20,
    // An actor whose sources declared nothing: the threat page's empty motivation and goal fields,
    // and the attack outcome overview's unstated bucket on both the resource level and motivation bars.
    primaryMotivation: null,
    resourceLevel: null,
    locations: [
      { name: 'Germany', country: 'Germany', days: 25, confidence: 55 },
    ],
    sectors: [
      { name: 'Technologies', days: 30, confidence: 55 },
    ],
    cves: [],
    techniques: [
      { ext: 'T1078', days: 20, confidence: 55 },
    ],
    // Declares a goal and no signature technique.
    goals: ['data breach'],
    attributedTo: [{ slug: 'kraken-syndicate', days: 18, confidence: 60 }],
  },
  {
    // Its techniques overlap no intrusion set's by the 60% at which the mixture folds two actors
    // into one, which is also why it carries no routine backbone.
    slug: 'kraken-syndicate',
    entityType: 'threat-actor',
    name: 'Kraken Syndicate',
    aliases: ['Deep Current'],
    anchorGrade: 'observed',
    description: 'Criminal syndicate brokering initial access to European banks and running the fraud that follows: payment diversion, account takeover and money-mule networks.',
    mitreGroupId: null,
    confidence: 70,
    firstSeenDaysAgo: 700,
    lastSeenDaysAgo: 12,
    primaryMotivation: 'personal-gain',
    resourceLevel: 'organization',
    sophistication: 'expert',
    threatActorTypes: ['crime-syndicate'],
    roles: ['sponsor', 'director'],
    locations: [
      { name: 'France', country: 'France', days: 14, confidence: 75 },
    ],
    sectors: [
      { name: 'Finance', days: 16, confidence: 80 },
    ],
    cves: [],
    techniques: [
      { ext: 'T1566', days: 12, confidence: 75 },
      { ext: 'T1656', days: 21, confidence: 70 },
      { ext: 'T1657', days: 30, confidence: 80 },
      { ext: 'T1565', days: 45, confidence: 65 },
    ],
  },
  {
    slug: 'operation-ledger-lure',
    entityType: 'campaign',
    name: 'Operation Ledger Lure',
    aliases: [],
    anchorGrade: 'observed',
    description: 'A summer wave of help-desk impersonation calls against British retail banks, used to reset employee MFA and reach payment back-office systems.',
    mitreGroupId: null,
    confidence: 70,
    firstSeenDaysAgo: 75,
    lastSeenDaysAgo: 10,
    primaryMotivation: 'personal-gain',
    resourceLevel: null,
    objective: 'Divert outgoing payments by taking over back-office accounts',
    locations: [
      { name: UK, country: UK, days: 11, confidence: 75 },
    ],
    sectors: [
      { name: 'Finance', days: 11, confidence: 80 },
    ],
    cves: [],
    techniques: [
      { ext: 'T1656', days: 10, confidence: 80 },
      { ext: 'T1111', days: 15, confidence: 70 },
      { ext: 'T1098', days: 24, confidence: 65 },
    ],
    attributedTo: [{ slug: 'scattered-spider', days: 10, confidence: 70 }],
  },
  {
    // Attributed to an authored intrusion set that states no window of its own: the campaign's
    // recent last_seen is the only thing that dates FIN7 as active.
    slug: 'operation-gilded-checkout',
    entityType: 'campaign',
    name: 'Operation Gilded Checkout',
    aliases: [],
    anchorGrade: 'observed',
    description: 'A spring wave of spearphishing against hotel and retail payment teams, delivering a trojanized reservation document that exfiltrates card data and prepares ransomware deployment.',
    mitreGroupId: null,
    confidence: 65,
    firstSeenDaysAgo: 60,
    lastSeenDaysAgo: 14,
    primaryMotivation: 'personal-gain',
    resourceLevel: null,
    objective: 'Harvest payment card data from hospitality point-of-sale systems',
    locations: [
      { name: USA, country: USA, days: 15, confidence: 75 },
    ],
    sectors: [
      { name: 'Hospitality', days: 15, confidence: 80 },
      { name: 'Finance', days: 28, confidence: 65 },
    ],
    cves: [],
    techniques: [
      { ext: 'T1566', days: 14, confidence: 80 },
      { ext: 'T1560', days: 22, confidence: 70 },
      { ext: 'T1041', days: 30, confidence: 75 },
    ],
    attributedTo: [{ slug: 'fin7', days: 14, confidence: 75 }],
  },
];

const daysAgo = (now: Date, days: number): Date => new Date(now.getTime() - days * 86_400_000);

const iso = (date: Date): string => date.toISOString();

// An authored-grade actor carries no activity window at all: its relationships omit `start_time`,
// so the anchor falls back to `created`, which is what real MITRE `uses` relations look like.
const startTimeOf = (actor: ActorSpec, now: Date, days: number): Date | null =>
  (actor.anchorGrade === 'observed' ? daysAgo(now, days) : null);

// The backbone is dated on the actor's most recent activity and stated at a middling confidence,
// below every write-up technique so the ranking of what the actor is known for is untouched.
const techniquesWithBackbone = (actor: ActorSpec): Array<{ ext: string } & ChildEvent> => {
  if (actor.walkBackbone !== true) {
    return actor.techniques;
  }
  const held = new Set(actor.techniques.map((technique) => technique.ext));
  return [
    ...actor.techniques,
    ...WALK_BACKBONE_EXTERNAL_IDS
      .filter((ext) => !held.has(ext))
      .map((ext) => ({ ext, days: actor.lastSeenDaysAgo, confidence: 55 })),
  ];
};

type StixObject = Record<string, unknown>;

type IdentifiedStixObject = StixObject & { id: string };

export interface StixBundle {
  type: 'bundle',
  id: string,
  spec_version: string,
  objects: Array<StixObject>,
}

const SPEC_VERSION = '2.1';
const MITRE_ATTACK_SOURCE = 'mitre-attack';
const BUNDLE_ID = 'bundle--0a0c1d3e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';

// The parser reads `is_inferred` only from this OpenCTI extension, never from a top-level field.
const OPENCTI_STIX_EXTENSION_ID = 'extension-definition--ea279b3e-5c71-4632-ac08-831c66a786ba';

const slugify = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const ENTITY_TYPE_BY_SLUG = new Map(ACTOR_SPECS.map((actor) => [actor.slug, actor.entityType ?? 'intrusion-set']));

const threatStixId = (slug: string): string => `${ENTITY_TYPE_BY_SLUG.get(slug) ?? 'intrusion-set'}--seed-${slug}`;

// One object per distinct target, shared by every actor claiming it, as a real export has it.
const locationStixId = (name: string): string => `location--seed-country-${slugify(name)}`;
const sectorStixId = (name: string): string => `identity--seed-sector-${slugify(name)}`;
const cveStixId = (cveId: string): string => `vulnerability--seed-${cveId.toLowerCase()}`;
const techniqueStixId = (ext: string): string => `attack-pattern--seed-${ext.toLowerCase()}`;

const childEventsOf = (actor: ActorSpec): Array<ChildEvent> => [
  ...actor.locations, ...actor.sectors, ...actor.cves, ...techniquesWithBackbone(actor),
];

const producerRefOf = (event: ChildEvent): string => event.producerStixId ?? DEFAULT_PRODUCER_STIX_ID;

interface ClaimRelationship {
  slug: string,
  kind: string,
  index: number,
  relationshipType: 'targets' | 'uses' | 'attributed-to',
  sourceRef: string,
  targetRef: string,
  stated: Date,
  startTime: Date | null,
  event: ChildEvent,
}

const relationshipObject = (claim: ClaimRelationship): StixObject => ({
  id: `relationship--seed-${claim.slug}-${claim.kind}-${claim.index}`,
  type: 'relationship',
  spec_version: SPEC_VERSION,
  relationship_type: claim.relationshipType,
  source_ref: claim.sourceRef,
  target_ref: claim.targetRef,
  created: iso(claim.stated),
  modified: iso(claim.stated),
  confidence: claim.event.confidence,
  created_by_ref: producerRefOf(claim.event),
  ...(claim.startTime === null ? {} : { start_time: iso(claim.startTime) }),
  ...(claim.event.isInferred === true
    ? { extensions: { [OPENCTI_STIX_EXTENSION_ID]: { is_inferred: true } } }
    : {}),
});

const threatObject = (actor: ActorSpec, now: Date): IdentifiedStixObject => {
  const firstSeen = daysAgo(now, actor.firstSeenDaysAgo);
  return {
    id: threatStixId(actor.slug),
    type: actor.entityType ?? 'intrusion-set',
    spec_version: SPEC_VERSION,
    name: actor.name,
    description: actor.description,
    aliases: actor.aliases,
    confidence: actor.confidence,
    created: iso(firstSeen),
    modified: iso(now),
    // `first_seen` and `last_seen` each open or close an observation window, so either grades the
    // actor observed on its own and would override every authored child anchor. An authored-grade
    // actor must carry neither.
    ...(actor.anchorGrade === 'observed'
      ? { first_seen: iso(firstSeen), last_seen: iso(daysAgo(now, actor.lastSeenDaysAgo)) }
      : {}),
    ...(actor.primaryMotivation === null ? {} : { primary_motivation: actor.primaryMotivation }),
    ...(actor.resourceLevel === null ? {} : { resource_level: actor.resourceLevel }),
    secondary_motivations: actor.secondaryMotivations ?? [],
    goals: actor.goals ?? [],
    labels: actor.labels ?? [],
    ...(actor.sophistication === undefined ? {} : { sophistication: actor.sophistication }),
    ...(actor.threatActorTypes === undefined ? {} : { threat_actor_types: actor.threatActorTypes }),
    ...(actor.roles === undefined ? {} : { roles: actor.roles }),
    ...(actor.objective === undefined ? {} : { objective: actor.objective }),
    ...(actor.mitreGroupId === null ? {} : {
      external_references: [{
        source_name: MITRE_ATTACK_SOURCE,
        external_id: actor.mitreGroupId,
        url: `https://attack.mitre.org/groups/${actor.mitreGroupId}`,
      }],
    }),
  };
};

export const buildAcmeThreatBundle = (now: Date): StixBundle => {
  const stamped = iso(now);
  const objects: Array<StixObject> = [];
  const emitted = new Set<string>();
  const emit = (object: IdentifiedStixObject): void => {
    if (!emitted.has(object.id)) {
      emitted.add(object.id);
      objects.push(object);
    }
  };

  for (const actor of ACTOR_SPECS) {
    for (const event of childEventsOf(actor)) {
      emit({
        id: producerRefOf(event),
        type: 'identity',
        spec_version: SPEC_VERSION,
        identity_class: 'organization',
        name: event.producerName ?? DEFAULT_PRODUCER_NAME,
        created: stamped,
        modified: stamped,
      });
    }
  }

  for (const actor of ACTOR_SPECS) {
    const sourceRef = threatStixId(actor.slug);
    emit(threatObject(actor, now));

    actor.locations.forEach((location, index) => {
      const targetRef = locationStixId(location.name);
      emit({
        id: targetRef,
        type: 'location',
        spec_version: SPEC_VERSION,
        name: location.name,
        created: stamped,
        modified: stamped,
        ...(location.country === null ? {} : { country: location.country }),
      });
      objects.push(relationshipObject({
        slug: actor.slug,
        kind: 'locations',
        index,
        relationshipType: 'targets',
        sourceRef,
        targetRef,
        stated: daysAgo(now, location.days),
        startTime: startTimeOf(actor, now, location.days),
        event: location,
      }));
    });

    actor.sectors.forEach((sector, index) => {
      const targetRef = sectorStixId(sector.name);
      emit({
        id: targetRef,
        type: 'identity',
        spec_version: SPEC_VERSION,
        identity_class: 'class',
        name: sector.name,
        created: stamped,
        modified: stamped,
      });
      objects.push(relationshipObject({
        slug: actor.slug,
        kind: 'sectors',
        index,
        relationshipType: 'targets',
        sourceRef,
        targetRef,
        stated: daysAgo(now, sector.days),
        startTime: startTimeOf(actor, now, sector.days),
        event: sector,
      }));
    });

    actor.cves.forEach((cveLink, index) => {
      const targetRef = cveStixId(cveLink.cveId);
      emit({
        id: targetRef,
        type: 'vulnerability',
        spec_version: SPEC_VERSION,
        name: cveLink.cveId,
        created: stamped,
        modified: stamped,
      });
      objects.push(relationshipObject({
        slug: actor.slug,
        kind: 'cves',
        index,
        relationshipType: 'targets',
        sourceRef,
        targetRef,
        stated: daysAgo(now, cveLink.days),
        startTime: startTimeOf(actor, now, cveLink.days),
        event: cveLink,
      }));
    });

    techniquesWithBackbone(actor).forEach((technique, index) => {
      const targetRef = techniqueStixId(technique.ext);
      emit({
        id: targetRef,
        type: 'attack-pattern',
        spec_version: SPEC_VERSION,
        name: TECHNIQUE_NAMES[technique.ext] ?? technique.ext,
        created: stamped,
        modified: stamped,
        external_references: [{
          source_name: MITRE_ATTACK_SOURCE,
          external_id: technique.ext,
          url: `https://attack.mitre.org/techniques/${technique.ext}`,
        }],
      });
      objects.push(relationshipObject({
        slug: actor.slug,
        kind: 'techniques',
        index,
        relationshipType: 'uses',
        sourceRef,
        targetRef,
        stated: daysAgo(now, technique.days),
        startTime: startTimeOf(actor, now, technique.days),
        event: technique,
      }));
    });

    (actor.attributedTo ?? []).forEach((attribution, index) => {
      objects.push(relationshipObject({
        slug: actor.slug,
        kind: 'attributions',
        index,
        relationshipType: 'attributed-to',
        sourceRef,
        targetRef: threatStixId(attribution.slug),
        stated: daysAgo(now, attribution.days),
        startTime: startTimeOf(actor, now, attribution.days),
        event: attribution,
      }));
    });
  }

  return { type: 'bundle', id: BUNDLE_ID, spec_version: SPEC_VERSION, objects };
};
