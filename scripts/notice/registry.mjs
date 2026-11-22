/**
 * What `scripts/notice.mjs` knows that no file can say by itself: which third-party works the
 * repository holds, the notice each one asks for, and why everything else needs none.
 *
 * Every path below is relative to the repository root and names one file: a pattern would let a data
 * file added beside it through unread.
 */

const MODULES = 'module/src/modules';
const TECHNIQUES = `${MODULES}/mitre-attack/data/mitre-techniques.ts`;
const CWE_PROVENANCE = `${MODULES}/cwe/data/cwe-technique-link-provenance.ts`;
const CTID_PROVENANCE = `${MODULES}/technique-mapping/data/technique-tables-provenance.ts`;
const ATTACK_SOURCE_ID = /id: 'attack-enterprise-([\d.]+)'/;

/**
 * Third-party works whose terms ask for a notice, rendered into `NOTICE` in this order.
 * `notice` is a file of `scripts/notice/notices/`. `release` and `copyrightFrom` record where the
 * copyright line was read; `versions` ties the release to the constant the code holds, so a data
 * bump fails the check until someone has read the notice again.
 */
export const DATASETS = [
  {
    id: 'mitre-attack',
    title: 'MITRE ATT&CK®',
    release: 'ATT&CK Enterprise 20.0',
    copyrightFrom: 'the marking definition of the ATT&CK Enterprise 20.0 STIX bundle, and the ATT&CK terms of use',
    notice: 'mitre-attack.txt',
    files: [
      `${MODULES}/mitre-attack/data/mitre-techniques.ts`,
      `${MODULES}/mitre-attack/data/mitre-mitigations.ts`,
      `${MODULES}/mitre-attack/data/mitre-tactics.ts`,
      `${MODULES}/controls/capability/data/capabilities.generated.ts`,
      `${MODULES}/threat-analyses/__fixtures__/apt17-arsenal-bundle.json`,
      `${MODULES}/threat-analyses/__fixtures__/renumbered-attack-pattern.json`,
      `${MODULES}/threat-analyses/__fixtures__/salt-typhoon-bundle.json`,
      'module/src/platform-seed/data/acme-threat-bundle.ts',
    ],
    versions: [
      { file: TECHNIQUES, pattern: /MITRE_ATTACK_CATALOGUE_RELEASE = '([^']+)'/, expected: '20.0' },
      { file: CWE_PROVENANCE, pattern: ATTACK_SOURCE_ID, expected: '20.0' },
      { file: CTID_PROVENANCE, pattern: ATTACK_SOURCE_ID, expected: '20.0' },
    ],
  },
  {
    id: 'cve-program',
    title: 'CVE® Program (MITRE)',
    release: 'CVE records as published, no version carried',
    copyrightFrom: 'the footer and the terms of use of cve.org, read in its source (CVEProject/cve-website)',
    notice: 'cve-program.txt',
    files: ['module/src/platform-seed/data/acme-cves.ts'],
    versions: [],
  },
  {
    id: 'mitre-cwe',
    title: 'MITRE CWE™',
    release: 'CWE 4.20',
    copyrightFrom: 'the CWE terms of use: the 4.20 catalogue file carries no copyright statement',
    notice: 'mitre-cwe.txt',
    files: [
      `${MODULES}/cwe/data/cwe-weaknesses.ts`,
      `${MODULES}/cwe/data/cwe-technique-link.ts`,
      CWE_PROVENANCE,
    ],
    versions: [
      { file: CWE_PROVENANCE, pattern: /id: 'cwe-([\d.]+)-xml'/, expected: '4.20' },
    ],
  },
  {
    id: 'mitre-capec',
    title: 'MITRE CAPEC™',
    release: 'CAPEC 3.9',
    copyrightFrom: 'the marking definition of the CAPEC 3.9 STIX file, and the CAPEC terms of use',
    notice: 'mitre-capec.txt',
    files: [`${MODULES}/cwe/data/cwe-technique-link.ts`],
    versions: [
      { file: CWE_PROVENANCE, pattern: /id: 'capec-([\d.]+)-stix'/, expected: '3.9' },
    ],
  },
  {
    id: 'mitre-d3fend',
    title: 'MITRE D3FEND™',
    release: 'identifiers only, no version carried',
    copyrightFrom: 'the LICENSE.md of the d3fend-ontology repository',
    notice: 'mitre-d3fend.txt',
    files: [`${MODULES}/controls/capability/data/capabilities.generated.ts`],
    versions: [],
  },
  {
    id: 'ctid-mappings-explorer',
    title: 'ATT&CK Mappings Explorer (Center for Threat-Informed Defense)',
    release: 'KEV mapping 07.28.2025, ATT&CK 16.1',
    copyrightFrom: 'the Notice section of the repository README',
    notice: 'ctid-mappings-explorer.txt',
    files: [
      `${MODULES}/technique-mapping/data/curated-technique-mappings.ts`,
      CTID_PROVENANCE,
    ],
    versions: [
      { file: CTID_PROVENANCE, pattern: /id: '(kev-[^']+)'/, expected: 'kev-07.28.2025_attack-16.1-enterprise' },
    ],
  },
  {
    id: 'opencti-datasets',
    title: 'OpenCTI datasets',
    release: 'no release carried',
    copyrightFrom: 'the LICENSE of the datasets repository, which names no holder',
    notice: 'opencti-datasets.txt',
    files: [
      `${MODULES}/countries/data/countries-data.ts`,
      `${MODULES}/sectors/data/sectors-data.ts`,
    ],
    versions: [],
  },
  {
    id: 'oasis-stix',
    title: 'OASIS STIX™ 2.1',
    release: 'STIX 2.1, OASIS Standard of 10 June 2021',
    copyrightFrom: 'the Notices section of the specification',
    notice: 'oasis-stix.txt',
    files: ['front/src/features/attack-outcomes/data/stix-vocabulary-definitions.ts'],
    versions: [],
  },
  {
    id: 'nist-csf',
    title: 'NIST Cybersecurity Framework 2.0',
    release: 'CSF 2.0',
    copyrightFrom: 'courtesy credit, the content is in the public domain',
    notice: 'nist-csf.txt',
    files: [`${MODULES}/compliance-assessments/data/nist-csf-2.0-catalog.json`],
    versions: [],
  },
  {
    id: 'natural-earth',
    title: 'Natural Earth',
    release: '1:50m admin-0, 5.1.2',
    copyrightFrom: 'courtesy credit, the content is in the public domain',
    notice: 'natural-earth.txt',
    files: ['back/static/maps/countries.json'],
    versions: [],
  },
  {
    id: 'openstreetmap',
    title: 'OpenStreetMap',
    release: 'Protomaps basemap 4.15.0',
    copyrightFrom: 'the attribution of the tile file and the OpenStreetMap copyright page',
    notice: 'openstreetmap.txt',
    files: ['back/static/maps/world.pmtiles'],
    versions: [],
  },
];

/**
 * Third-party data OpenCRQ does not ship but fetches when a connector runs, whose terms ask for a
 * credit. Rendered into `NOTICE` in this order; `notice` is a file of `scripts/notice/notices/`.
 */
export const RUNTIME_SOURCES = [
  {
    title: 'NIST National Vulnerability Database (NVD)',
    readBy: 'the NIST NVD CVE connector',
    notice: 'nist-nvd.txt',
  },
  {
    title: 'FIRST Exploit Prediction Scoring System (EPSS)',
    readBy: 'the FIRST EPSS connector',
    notice: 'first-epss.txt',
  },
  {
    title: 'MITRE ATT&CK® groups and campaigns (OpenCRQ Default Threats dataset)',
    readBy: 'the OpenCRQ Default Threats connector',
    notice: 'opencrq-default-threats.txt',
  },
];

/**
 * Third-party works reviewed in the legal checklist that ask for no notice here. Rendered nowhere.
 */
export const REVIEWED = [
  {
    reason: 'Logos of third-party organisations and products, a trademark matter outside this file.',
    files: [
      'front/public/img/icon-cisa.png',
      'front/public/img/icon-first.png',
      'front/public/img/icon-microsoft-defender.png',
      'front/public/img/icon-nist.png',
    ],
  },
  {
    reason: 'Drata control identifiers only, no catalogue text.',
    files: [`${MODULES}/drata/data/drata-capability-mapping.generated.ts`],
  },
  {
    reason: 'In-house control catalogue. Its crosswalk names third-party identifiers, which carry their owner\'s notice through the entries above; the NIST ones are in the public domain.',
    files: [`${MODULES}/controls/capability/data/capabilities.generated.ts`],
  },
];

/**
 * Data written in this repository or by Filigran. An entry with a `declaration` is stated in
 * `NOTICE`, the others are only classified.
 */
export const FIRST_PARTY = [
  {
    reason: 'Filigran internal model.',
    declaration: 'The outcome counter model is a Filigran internal model. It is not third-party data.',
    files: [
      `${MODULES}/threat-analyses/outcome-counter/outcome-counter-model/calibration.json`,
      `${MODULES}/threat-analyses/outcome-counter/outcome-counter-model/known-groups.json`,
      `${MODULES}/threat-analyses/outcome-counter/outcome-counter-model/logistic.json`,
      `${MODULES}/threat-analyses/outcome-counter/__fixtures__/parity-expected.json`,
      `${MODULES}/threat-analyses/outcome-counter/__fixtures__/parity-records.json`,
    ],
  },
  {
    reason: 'Threat event frequency catalogue built by Filigran, whose one source is Filigran Intelligence.',
    files: [`${MODULES}/tef-catalog/data/opencrq-open-data.json`],
  },
  {
    reason: 'Filigran and OpenCRQ brand assets.',
    files: [
      '.github/img/logo_opencrq.svg',
      '.github/img/readme/banner.svg',
      '.github/img/readme/flow-dark.svg',
      '.github/img/readme/flow-light.svg',
      '.github/img/readme/g1-dark.webp',
      '.github/img/readme/g1-light.webp',
      '.github/img/readme/g2-dark.webp',
      '.github/img/readme/g2-light.webp',
      '.github/img/readme/g3-dark.webp',
      '.github/img/readme/g3-light.webp',
      '.github/img/readme/g4-dark.webp',
      '.github/img/readme/g4-light.webp',
      '.github/img/readme/g5-dark.webp',
      '.github/img/readme/g5-light.webp',
      '.github/img/readme/g6-dark.webp',
      '.github/img/readme/g6-light.webp',
      '.github/img/readme/hero-dark.webp',
      '.github/img/readme/hero-light.webp',
      '.github/img/readme/stars-dark.svg',
      '.github/img/readme/stars-light.svg',
      '.github/img/readme/walkthrough-dark.webp',
      '.github/img/readme/walkthrough-light.webp',
      '.github/img/readme/xtm-platform-ctem-dark.svg',
      '.github/img/readme/xtm-platform-ctem-light.svg',
      'front/public/favicon.ico',
      'front/public/filigran-dark.svg',
      'front/public/filigran-emblem-dark.svg',
      'front/public/filigran-emblem-light.svg',
      'front/public/filigran-light.svg',
      'front/public/logo-openaev-dark.svg',
      'front/public/logo-openaev-light.svg',
      'front/public/logo-opencrq-dark.svg',
      'front/public/logo-opencrq-light.svg',
      'front/public/logo-opencti-dark.svg',
      'front/public/logo-opencti-light.svg',
      'front/public/logo-xtm-hub-dark.svg',
      'front/public/logo-xtm-hub-light.svg',
      'front/public/img/icon-openaev.png',
      'front/public/img/icon-opencrq.svg',
      'front/public/img/icon-opencti.png',
      'front/public/img/xtm-mark-openaev.svg',
      'front/public/img/xtm-mark-opencti.svg',
    ],
  },
  {
    reason: 'Demo tenant data authored in this repository.',
    files: [
      'module/src/platform-seed/data/acme-cves.ts',
      'module/src/platform-seed/data/acme-expectation-findings.ts',
      'module/src/platform-seed/data/acme-findings.ts',
      'module/src/platform-seed/data/acme-threat-bundle.ts',
      'module/src/platform-seed/data/acme-threat-outcome-probabilities.ts',
      'module/src/platform-seed/data/attacker-classes.ts',
      'module/src/platform-seed/data/budget-review-story.ts',
      'module/src/platform-seed/data/declared-estate.ts',
      'module/src/platform-seed/data/financial-profiles.ts',
      'module/src/platform-seed/data/ids.ts',
      'module/src/platform-seed/data/organizations.ts',
      'module/src/platform-seed/data/users.ts',
    ],
  },
  {
    reason: 'Reference data authored in this repository.',
    files: [
      `${MODULES}/attack-outcomes/data/attack-outcomes-data.ts`,
      `${MODULES}/attack-outcomes/data/attack-outcomes-ids.ts`,
      `${MODULES}/attack-outcomes/data/attack-outcomes-seed.ts`,
      `${MODULES}/attack-outcomes/data/attack-paths-data.ts`,
      `${MODULES}/attack-outcomes/data/index.ts`,
      `${MODULES}/attack-surfaces/data/applicable-techniques-data.ts`,
      `${MODULES}/attack-surfaces/data/applicable-techniques-seed.ts`,
      `${MODULES}/attack-surfaces/data/index.ts`,
      `${MODULES}/business-value-categories/data/business-value-categories-data.ts`,
      `${MODULES}/business-value-categories/data/business-value-categories-ids.ts`,
      `${MODULES}/business-value-categories/data/business-value-categories-seed.ts`,
      `${MODULES}/business-value-categories/data/index.ts`,
      `${MODULES}/capabilities/data/capabilities-data.ts`,
      `${MODULES}/capabilities/data/capabilities-ids.ts`,
      `${MODULES}/capabilities/data/capabilities-seed.ts`,
      `${MODULES}/capabilities/data/index.ts`,
      `${MODULES}/platform-capabilities/data/index.ts`,
      `${MODULES}/platform-capabilities/data/platform-capabilities-data.ts`,
      `${MODULES}/platform-capabilities/data/platform-capabilities-ids.ts`,
      `${MODULES}/platform-capabilities/data/platform-capabilities-seed.ts`,
      `${MODULES}/platform-groups/data/default-platform-groups.ts`,
      `${MODULES}/platform-groups/data/index.ts`,
      `${MODULES}/platform-roles/data/default-platform-roles.ts`,
      `${MODULES}/platform-roles/data/index.ts`,
      `${MODULES}/loss-drivers/data/index.ts`,
      `${MODULES}/loss-drivers/data/loss-activation-matrix.ts`,
      `${MODULES}/loss-drivers/data/loss-drivers-constants.ts`,
      `${MODULES}/loss-drivers/data/loss-drivers-data.ts`,
      `${MODULES}/loss-drivers/data/loss-drivers-ids.ts`,
      `${MODULES}/loss-drivers/data/loss-drivers-seed.ts`,
      `${MODULES}/compliance-assessments/data/compliance-frameworks-seed.ts`,
      `${MODULES}/compliance-assessments/data/nist-csf-2.0-control-mapping.json`,
      `${MODULES}/compliance-assessments/data/oscal-catalog.ts`,
      `${MODULES}/compliance-assessments/data/oscal-mapping.ts`,
      `${MODULES}/controls/capability/data/control-capabilities-seed.ts`,
      `${MODULES}/controls/capability/data/control-family-protection-seed.ts`,
      `${MODULES}/controls/capability/data/control-family-protection.ts`,
      `${MODULES}/controls/capability/data/index.ts`,
      `${MODULES}/controls/capability/data/security-platform-families-seed.ts`,
      `${MODULES}/controls/capability/data/security-platform-families.ts`,
      `${MODULES}/countries/data/countries-seed.ts`,
      `${MODULES}/countries/data/index.ts`,
      `${MODULES}/cwe/data/cwe-link-rows.ts`,
      `${MODULES}/cwe/data/cwe-link-seed.ts`,
      `${MODULES}/cwe/data/index.ts`,
      `${MODULES}/mitre-attack/data/index.ts`,
      `${MODULES}/mitre-attack/data/mitre-attack-seed.ts`,
      `${MODULES}/sectors/data/index.ts`,
      `${MODULES}/sectors/data/sectors-seed.ts`,
      `${MODULES}/technique-mapping/data/cited-techniques.ts`,
      `${MODULES}/technique-mapping/data/index.ts`,
    ],
  },
];

/** Files the data scan skips: generated from this repository, or not part of what is distributed. */
export const IGNORED = [
  { pattern: /^(?:LICENSE|NOTICE|yarn\.lock)$/, reason: 'This repository\'s licence, notice and lockfile.' },
  { pattern: /^\.github\/(?!img\/)/, reason: 'CI workflows and repository settings.' },
  { pattern: /^module\/src\/db\/migrations\/meta\//, reason: 'Drizzle snapshots of this repository\'s schema.' },
  { pattern: /^front\/src\/locales\//, reason: 'Translations of this repository\'s strings.' },
  { pattern: /^back\/trpc-procedures\.json$/, reason: 'Manifest generated from this repository\'s router.' },
  { pattern: /^back\/src\/features\/xtm-one\/contract\//, reason: 'Contract files copied from the Filigran XTM One platform.' },
  { pattern: /^integration-tests\/test-durations\.json$/, reason: 'Timings measured on this repository\'s tests.' },
  { pattern: /^infra\//, reason: 'Development tooling configuration, not distributed.' },
];
