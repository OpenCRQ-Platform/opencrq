// Generated reference data. Edit the generator, never this file.

export interface TechniqueTableSource {
  readonly id: string,
  readonly sha256: string,
}

export interface TechniqueRewrite {
  readonly from: string,
  readonly to: string,
}

export interface TechniqueTablesProvenance {
  /** Content digest of the curated table. Equal across two generations that changed nothing. */
  readonly tablesVersion: string,
  readonly generatedAt: string,
  readonly sources: ReadonlyArray<TechniqueTableSource>,
  readonly license: string,
  /** Identifiers a later ATT&CK release retired, rewritten to their successors before emission. */
  readonly rewrittenTechniques: ReadonlyArray<TechniqueRewrite>,
  /** Retired identifiers with no live successor, dropped rather than emitted. */
  readonly droppedTechniques: ReadonlyArray<string>,
  readonly curatedVulnerabilityCount: number,
  readonly curatedRowCount: number,
  readonly curatedRowCountByRole: Readonly<Record<string, number>>,
}

export const TECHNIQUE_TABLES_PROVENANCE: TechniqueTablesProvenance = {
  tablesVersion: 'ed6ec18e89c2',
  generatedAt: '2026-10-27',
  sources: [
    { id: 'kev-07.28.2025_attack-16.1-enterprise', sha256: '6b2dd0f28463381c006016db953dc97057074b5bb5a3d3fe87a794ace45a8e63' },
    { id: 'attack-enterprise-20.0', sha256: '81113ba98afa2928f3dcff62022539f7ce30c315c32e14422f11ff95ce534352' },
  ],
  license: 'ATT&CK Mappings Explorer by the Center for Threat-Informed Defense, Apache 2.0. ATT&CK and CAPEC are MITRE trademarks, and their content is used under the MITRE terms of use.',
  rewrittenTechniques: [
    { from: 'T1070.001', to: 'T1685.005' },
    { from: 'T1562', to: 'T1685' },
    { from: 'T1562.001', to: 'T1685' },
  ],
  droppedTechniques: [],
  curatedVulnerabilityCount: 419,
  curatedRowCount: 1183,
  curatedRowCountByRole: {
    exploitation_technique: 460,
    primary_impact: 407,
    secondary_impact: 316,
  },
};
