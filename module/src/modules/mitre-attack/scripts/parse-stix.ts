/* eslint-disable no-console, func-style */
/**
 * STIX 2.1 parser for MITRE ATT&CK Enterprise data.
 *
 * Usage: npx tsx parse-stix.ts <path-to-enterprise-attack.json>
 *
 * Generates TypeScript data files with deterministic UUIDs in ../data/
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v5 as uuidv5 } from 'uuid';

// Stable namespace for deterministic UUID generation
const MITRE_NAMESPACE = '9b5f1e4a-2c3d-4b6e-8f7a-1d2e3f4a5b6c';

// Tactic order based on ATT&CK kill chain (v20)
const TACTIC_ORDER: Record<string, number> = {
  'reconnaissance': 1,
  'resource-development': 2,
  'initial-access': 3,
  'execution': 4,
  'persistence': 5,
  'privilege-escalation': 6,
  'stealth': 7,
  'defense-impairment': 8,
  'credential-access': 9,
  'discovery': 10,
  'lateral-movement': 11,
  'collection': 12,
  'command-and-control': 13,
  'exfiltration': 14,
  'impact': 15,
};

interface StixObject {
  type: string,
  id: string,
  name?: string,
  description?: string,
  revoked?: boolean,
  x_mitre_deprecated?: boolean,
  external_references?: Array<{
    source_name: string,
    external_id?: string,
    url?: string,
  }>,
  x_mitre_shortname?: string,
  x_mitre_is_subtechnique?: boolean,
  x_mitre_version?: string,
  kill_chain_phases?: Array<{
    kill_chain_name: string,
    phase_name: string,
  }>,
  relationship_type?: string,
  source_ref?: string,
  target_ref?: string,
}

interface StixBundle {
  type: string,
  objects: Array<StixObject>,
}

function generateId(stixId: string): string {
  return uuidv5(stixId, MITRE_NAMESPACE);
}

function isActive(obj: StixObject): boolean {
  return !obj.revoked && !obj.x_mitre_deprecated;
}

/**
 * Follow the revoked-by chain transitively until the final active replacement.
 * Returns null if:
 *   - stixId has no revoked-by mapping (deprecated without replacement)
 *   - the terminal of the chain is itself revoked without a successor
 *   - a cycle is detected
 */
function resolveTransitive(stixId: string, map: Map<string, string>, revokedIds: Set<string>): string | null {
  let current = map.get(stixId);
  const visited = new Set<string>([stixId]);
  while (current !== undefined && map.has(current)) {
    if (visited.has(current)) {
      return null; // cycle detected → no valid replacement
    }
    visited.add(current);
    current = map.get(current);
  }
  // Terminal node is itself revoked/deprecated without successor → ignore
  if (current !== undefined && revokedIds.has(current)) {
    return null;
  }
  return current ?? null;
}

function getMitreRef(obj: StixObject): { externalId: string, url: string } | null {
  const ref = obj.external_references?.find((r) => r.source_name === 'mitre-attack');
  if (!ref?.external_id) {
    return null;
  }
  return { externalId: ref.external_id, url: ref.url ?? '' };
}

function toConstName(prefix: string, externalId: string): string {
  return `${prefix}_${externalId.replace(/\./g, '_')}`;
}

function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n');
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: npx tsx parse-stix.ts <path-to-enterprise-attack.json>');
    process.exit(1);
  }

  const stixPath = resolve(args[0]);
  console.log(`Reading STIX data from ${stixPath}...`);
  const bundle: StixBundle = JSON.parse(readFileSync(stixPath, 'utf-8'));
  const objects = bundle.objects;

  const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data');

  const attackRelease = objects.find((o) => o.type === 'x-mitre-collection')?.x_mitre_version;
  if (!attackRelease) {
    console.error('The bundle states no ATT&CK release (no x-mitre-collection object)');
    process.exit(1);
  }

  // --- Parse Tactics ---
  const tactics = objects
    .filter((o) => o.type === 'x-mitre-tactic' && isActive(o))
    .flatMap((o) => {
      const ref = getMitreRef(o);
      if (!ref) {
        return [];
      }
      const shortname = o.x_mitre_shortname ?? '';
      return [{
        id: generateId(o.id),
        externalId: ref.externalId,
        name: o.name ?? '',
        description: o.description ?? '',
        url: ref.url,
        shortname,
        order: TACTIC_ORDER[shortname] ?? 99,
      }];
    })
    .sort((a, b) => a.order - b.order);

  console.log(`Tactics: ${tactics.length}`);

  // Build shortname → UUID map for technique-tactic linking
  const shortnameToTacticId = new Map(tactics.map((t) => [t.shortname, t.id]));

  // --- Build revocation map from STIX relationships ---
  // Maps source stixId → target stixId for 'revoked-by' relationships
  const revocationMap = new Map<string, string>();
  objects
    .filter((o) => o.type === 'relationship' && o.relationship_type === 'revoked-by')
    .forEach((o) => {
      if (o.source_ref && o.target_ref) {
        revocationMap.set(o.source_ref, o.target_ref);
      }
    });

  // Set of all enterprise technique stixIds (for validating replacements are in-dataset)
  const enterpriseTechniqueStixIds = new Set(
    objects.filter((o) => o.type === 'attack-pattern').map((o) => o.id),
  );

  // Set of revoked/deprecated technique stixIds (used by resolveTransitive to reject chains that end on a revoked node)
  const revokedStixIds = new Set(
    objects
      .filter((o) => o.type === 'attack-pattern' && (o.revoked === true || o.x_mitre_deprecated === true))
      .map((o) => o.id),
  );

  // --- Parse Techniques (include revoked) ---
  const allTechniques = objects
    .filter((o) => o.type === 'attack-pattern' && getMitreRef(o) !== null)
    .map((o) => {
      const ref = getMitreRef(o)!;
      const isSubtechnique = o.x_mitre_is_subtechnique ?? false;
      const tacticShortnames = (o.kill_chain_phases ?? [])
        .filter((p) => p.kill_chain_name === 'mitre-attack')
        .map((p) => p.phase_name);
      const tacticIds = tacticShortnames
        .map((sn) => shortnameToTacticId.get(sn))
        .filter((id): id is string => id !== undefined);

      // Derive parent technique ID from external ID (T1566.001 → T1566)
      let parentExternalId: string | null = null;
      if (isSubtechnique && ref.externalId.includes('.')) {
        parentExternalId = ref.externalId.split('.')[0];
      }

      const isRevoked = o.revoked === true || o.x_mitre_deprecated === true;
      const replacementStixId = resolveTransitive(o.id, revocationMap, revokedStixIds);
      const replacedByTechniqueId = (replacementStixId !== null && enterpriseTechniqueStixIds.has(replacementStixId))
        ? generateId(replacementStixId)
        : null;

      return {
        id: generateId(o.id),
        stixId: o.id,
        externalId: ref.externalId,
        name: o.name ?? '',
        description: o.description ?? '',
        url: ref.url,
        isSubtechnique,
        parentExternalId,
        tacticIds,
        revoked: isRevoked,
        replacedByTechniqueId,
      };
    })
    .sort((a, b) => a.externalId.localeCompare(b.externalId, undefined, { numeric: true }));

  // Build externalId → UUID map for parent references
  const externalIdToTechniqueId = new Map(allTechniques.map((t) => [t.externalId, t.id]));

  // Resolve parent technique IDs
  const techniques = allTechniques.map((t) => ({
    ...t,
    parentTechniqueId: t.parentExternalId ? (externalIdToTechniqueId.get(t.parentExternalId) ?? null) : null,
  }));

  const parentTechniques = techniques.filter((t) => !t.isSubtechnique && !t.revoked);
  const subTechniques = techniques.filter((t) => t.isSubtechnique && !t.revoked);
  const revokedTechniques = techniques.filter((t) => t.revoked);
  console.log(`Techniques (parent, active): ${parentTechniques.length}`);
  console.log(`Techniques (sub, active): ${subTechniques.length}`);
  console.log(`Techniques (revoked): ${revokedTechniques.length}`);

  // --- Parse Mitigations ---
  const mitigations = objects
    .filter((o) => o.type === 'course-of-action' && isActive(o))
    .flatMap((o) => {
      const ref = getMitreRef(o);
      if (!ref) {
        return [];
      }
      return [{
        id: generateId(o.id),
        externalId: ref.externalId,
        name: o.name ?? '',
        description: o.description ?? '',
        url: ref.url,
      }];
    })
    .sort((a, b) => a.externalId.localeCompare(b.externalId, undefined, { numeric: true }));

  console.log(`Mitigations: ${mitigations.length}`);

  // --- Parse Mitigation-Technique Relationships ---
  const stixIdToTechniqueId = new Map(
    objects
      .filter((o) => o.type === 'attack-pattern' && isActive(o))
      .map((o) => [o.id, generateId(o.id)]),
  );
  const stixIdToMitigationId = new Map(
    objects
      .filter((o) => o.type === 'course-of-action' && isActive(o))
      .map((o) => [o.id, generateId(o.id)]),
  );

  const mitigationTechniqueLinks = objects
    .filter((o) =>
      o.type === 'relationship'
      && o.relationship_type === 'mitigates'
      && isActive(o)
      && o.source_ref
      && o.target_ref
      && stixIdToMitigationId.has(o.source_ref)
      && stixIdToTechniqueId.has(o.target_ref),
    )
    .map((o) => ({
      mitigationId: stixIdToMitigationId.get(o.source_ref!)!,
      techniqueId: stixIdToTechniqueId.get(o.target_ref!)!,
    }));

  // Deduplicate
  const uniqueMitTechLinks = [...new Map(
    mitigationTechniqueLinks.map((l) => [`${l.mitigationId}:${l.techniqueId}`, l]),
  ).values()];

  console.log(`Mitigation-Technique links: ${uniqueMitTechLinks.length}`);

  // --- Build technique-tactic junction data ---
  const techniqueTacticLinks: Array<{ techniqueId: string, tacticId: string }> = [];
  for (const tech of techniques) {
    for (const tacticId of tech.tacticIds) {
      techniqueTacticLinks.push({ techniqueId: tech.id, tacticId });
    }
  }
  console.log(`Technique-Tactic links: ${techniqueTacticLinks.length}`);

  // --- Generate Tactics File ---
  const tacticsLines = [
    '// Auto-generated by parse-stix.ts — DO NOT EDIT',
    '',
    'export interface MitreTacticData {',
    '  id: string,',
    '  externalId: string,',
    '  name: string,',
    '  description: string,',
    '  url: string,',
    '  order: number,',
    '}',
    '',
    '// --- Tactic IDs ---',
    '',
    ...tactics.map((t) => `export const ${toConstName('TACTIC', t.externalId)} = '${t.id}';`),
    '',
    'export const mitreTacticsData: Array<MitreTacticData> = [',
    ...tactics.map((t) => [
      '  {',
      `    id: ${toConstName('TACTIC', t.externalId)},`,
      `    externalId: '${t.externalId}',`,
      `    name: '${escapeString(t.name)}',`,
      `    description: '${escapeString(t.description)}',`,
      `    url: '${t.url}',`,
      `    order: ${t.order},`,
      '  },',
    ].join('\n')),
    '];',
    '',
  ];

  writeFileSync(resolve(outputDir, 'mitre-tactics.ts'), tacticsLines.join('\n'));
  console.log('Written: mitre-tactics.ts');

  // --- Generate Techniques File ---
  const techniquesLines = [
    '// Auto-generated by parse-stix.ts — DO NOT EDIT',
    '',
    'export interface MitreTechniqueData {',
    '  id: string,',
    '  /** MITRE\'s own STIX id, which a threat feed cites the technique by. */',
    '  stixId: string,',
    '  externalId: string,',
    '  name: string,',
    '  description: string,',
    '  url: string,',
    '  isSubtechnique: boolean,',
    '  parentTechniqueId: string | null,',
    '  tacticIds: Array<string>,',
    '  revoked: boolean,',
    '  replacedByTechniqueId: string | null,',
    '}',
    '',
    '/** The ATT&CK Enterprise release this catalogue is generated from. */',
    `export const MITRE_ATTACK_CATALOGUE_RELEASE = '${attackRelease}';`,
    '',
    '// --- Technique IDs ---',
    '',
    ...techniques.map((t) => `export const ${toConstName('TECHNIQUE', t.externalId)} = '${t.id}';`),
    '',
    'export const mitreTechniquesData: Array<MitreTechniqueData> = [',
    ...techniques.map((t) => {
      const tacticIdsStr = t.tacticIds.length > 0
        ? `[${t.tacticIds.map((id) => `'${id}'`).join(', ')}]`
        : '[]';
      const parentRef = t.parentTechniqueId
        ? `'${t.parentTechniqueId}'`
        : 'null';
      const replacedByRef = t.replacedByTechniqueId
        ? `'${t.replacedByTechniqueId}'`
        : 'null';
      return [
        '  {',
        `    id: '${t.id}',`,
        `    stixId: '${t.stixId}',`,
        `    externalId: '${t.externalId}',`,
        `    name: '${escapeString(t.name)}',`,
        `    description: '${escapeString(t.description)}',`,
        `    url: '${t.url}',`,
        `    isSubtechnique: ${t.isSubtechnique},`,
        `    parentTechniqueId: ${parentRef},`,
        `    tacticIds: ${tacticIdsStr},`,
        `    revoked: ${t.revoked},`,
        `    replacedByTechniqueId: ${replacedByRef},`,
        '  },',
      ].join('\n');
    }),
    '];',
    '',
  ];

  writeFileSync(resolve(outputDir, 'mitre-techniques.ts'), techniquesLines.join('\n'));
  console.log('Written: mitre-techniques.ts');

  // --- Generate Mitigations File ---
  const mitigationsLines = [
    '// Auto-generated by parse-stix.ts — DO NOT EDIT',
    '',
    'export interface MitreMitigationData {',
    '  id: string,',
    '  externalId: string,',
    '  name: string,',
    '  description: string,',
    '  url: string,',
    '  techniqueIds: Array<string>,',
    '}',
    '',
    '// --- Mitigation IDs ---',
    '',
    ...mitigations.map((m) => `export const ${toConstName('MITIGATION', m.externalId)} = '${m.id}';`),
    '',
    'export const mitreMitigationsData: Array<MitreMitigationData> = [',
    ...mitigations.map((m) => {
      const techIds = uniqueMitTechLinks
        .filter((l) => l.mitigationId === m.id)
        .map((l) => l.techniqueId);
      const techIdsStr = techIds.length > 0
        ? `[${techIds.map((id) => `'${id}'`).join(', ')}]`
        : '[]';
      return [
        '  {',
        `    id: '${m.id}',`,
        `    externalId: '${m.externalId}',`,
        `    name: '${escapeString(m.name)}',`,
        `    description: '${escapeString(m.description)}',`,
        `    url: '${m.url}',`,
        `    techniqueIds: ${techIdsStr},`,
        '  },',
      ].join('\n');
    }),
    '];',
    '',
  ];

  writeFileSync(resolve(outputDir, 'mitre-mitigations.ts'), mitigationsLines.join('\n'));
  console.log('Written: mitre-mitigations.ts');

  // --- Generate Index File ---
  const indexLines = [
    '// Auto-generated by parse-stix.ts — DO NOT EDIT',
    '',
    'export * from \'./mitre-tactics\';',
    'export * from \'./mitre-techniques\';',
    'export * from \'./mitre-mitigations\';',
    '',
  ];

  writeFileSync(resolve(outputDir, 'index.ts'), indexLines.join('\n'));
  console.log('Written: index.ts');

  console.log('\nDone! Summary:');
  console.log(`  Tactics: ${tactics.length}`);
  console.log(`  Techniques (parent, active): ${parentTechniques.length}`);
  console.log(`  Techniques (sub, active): ${subTechniques.length}`);
  console.log(`  Techniques (revoked): ${revokedTechniques.length}`);
  console.log(`  Techniques with replacement: ${techniques.filter((t) => t.replacedByTechniqueId !== null).length}`);
  console.log(`  Revocation map entries: ${revocationMap.size}`);
  console.log(`  Technique-Tactic links: ${techniqueTacticLinks.length}`);
  console.log(`  Mitigations: ${mitigations.length}`);
  console.log(`  Mitigation-Technique links: ${uniqueMitTechLinks.length}`);
}

main();
