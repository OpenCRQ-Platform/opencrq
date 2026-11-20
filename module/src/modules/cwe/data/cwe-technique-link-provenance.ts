// Generated reference data. Edit the generator, never this file.

export interface CweTechniqueLinkProvenance {
  /** Content digest of the weaknesses and the link. Equal across two generations that changed nothing. */
  readonly linkVersion: string,
  readonly generatedAt: string,
  readonly sources: ReadonlyArray<{ readonly id: string, readonly sha256: string }>,
  readonly license: string,
  /** Who reviewed the attack-pattern chain rows, and when. */
  readonly chainReview: { readonly reviewer: string, readonly reviewedAt: string, readonly rejectedRows: number },
  /** Identifiers a later ATT&CK release retired, rewritten to their successors before emission. */
  readonly rewrittenTechniques: ReadonlyArray<{ readonly from: string, readonly to: string }>,
  /** Retired identifiers with no live successor, dropped rather than emitted. */
  readonly droppedTechniques: ReadonlyArray<string>,
  readonly weaknessCount: number,
  readonly linkedWeaknessCount: number,
  readonly rowCount: number,
  readonly rowCountByJustification: Readonly<Record<string, number>>,
}

export const CWE_TECHNIQUE_LINK_PROVENANCE: CweTechniqueLinkProvenance = {
  linkVersion: '88e0cee1ea95',
  generatedAt: '2026-10-27',
  sources: [
    { id: 'cwe-4.20-xml', sha256: '3976f599e5e5200219a3108bb896d06e2a88fbb293369e1883cb423a5e9d7d50' },
    { id: 'capec-3.9-stix', sha256: 'ee6244f48259c1963d0507535e1843d67ba08fe58b4dfe351c1b74f9e376fa69' },
    { id: 'attack-enterprise-20.0', sha256: '81113ba98afa2928f3dcff62022539f7ce30c315c32e14422f11ff95ce534352' },
  ],
  license: 'CWE, CAPEC and ATT&CK are MITRE trademarks, and their content is used under the MITRE terms of use.',
  chainReview: { reviewer: 'claude-opus-5-5 over disjoint thirds of the rows, claude-fable-5-1 blind second review where they differed, validated by the product owner', reviewedAt: '2026-09-27', rejectedRows: 190 },
  rewrittenTechniques: [
    { from: 'T1562.001', to: 'T1685' },
    { from: 'T1562.002', to: 'T1685.001' },
    { from: 'T1562.003', to: 'T1690' },
    { from: 'T1562.004', to: 'T1686' },
    { from: 'T1562.007', to: 'T1686.001' },
    { from: 'T1562.008', to: 'T1685.002' },
    { from: 'T1562.009', to: 'T1688' },
    { from: 'T1574.002', to: 'T1574.001' },
  ],
  droppedTechniques: ['T1513'],
  weaknessCount: 944,
  linkedWeaknessCount: 582,
  rowCount: 1738,
  rowCountByJustification: {
    attack_pattern: 415,
    consequence: 1323,
  },
};
