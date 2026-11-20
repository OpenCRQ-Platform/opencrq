import type { CrosswalkFramework } from '@app/module/client';
import type { CapabilityCrosswalk } from '../types/capability';

// Canonical, human-readable names for the external frameworks and standards the control
// catalogue crosswalks to. These are published-standard proper nouns, so they are not
// translated. The array order also drives the display order of the crosswalk groups: the
// broadly-recognised control catalogues come first, then the MITRE-family references.
/* eslint-disable lingui/no-unlocalized-strings -- published-standard proper nouns, never translated */
const CROSSWALK_FRAMEWORK_LABELS: Array<[CrosswalkFramework, string]> = [
  ['nist_800_53', 'NIST SP 800-53'],
  ['csf_2_0', 'NIST CSF 2.0'],
  ['iso_27001', 'ISO/IEC 27001'],
  ['attack_mitigations', 'MITRE ATT&CK Mitigations'],
  ['d3fend', 'MITRE D3FEND'],
];
/* eslint-enable lingui/no-unlocalized-strings */

const LABEL_BY_FRAMEWORK = new Map<string, string>(CROSSWALK_FRAMEWORK_LABELS);
const ORDER_BY_FRAMEWORK = new Map<string, number>(
  CROSSWALK_FRAMEWORK_LABELS.map(([framework], index) => [framework, index]),
);

// Falls back to the raw code so an as-yet-unmapped framework still renders something usable.
export const crosswalkFrameworkLabel = (framework: string): string =>
  LABEL_BY_FRAMEWORK.get(framework) ?? framework;

export interface CrosswalkGroup {
  framework: string,
  label: string,
  externalIds: Array<string>,
}

// Collapses the flat crosswalk rows into one group per framework, each with its external
// ids sorted for stable, scannable output, and the groups themselves in display order.
export const groupCrosswalkByFramework = (
  entries: Array<CapabilityCrosswalk>,
): Array<CrosswalkGroup> => {
  const byFramework = new Map<string, Array<string>>();
  for (const entry of entries) {
    const externalIds = byFramework.get(entry.framework) ?? [];
    externalIds.push(entry.externalId);
    byFramework.set(entry.framework, externalIds);
  }

  return [...byFramework.entries()]
    .map(([framework, externalIds]) => ({
      framework,
      label: crosswalkFrameworkLabel(framework),
      externalIds: [...externalIds].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => {
      const orderA = ORDER_BY_FRAMEWORK.get(a.framework) ?? Number.MAX_SAFE_INTEGER;
      const orderB = ORDER_BY_FRAMEWORK.get(b.framework) ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB || a.label.localeCompare(b.label);
    });
};
