import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression gate of FilterPill (Design standards s.3): a records list drawn with DataPageLayout
 * filters through typed filter pills, never a plain Select in its toolbar. The lists that still
 * carry a Select are allowlisted with their count; the counts only shrink. A file that moves its
 * filters to FilterPill lowers its count in the same commit, and the entry is deleted at 0.
 */
const PENDING: Record<string, number> = {
  'features/asset-dependencies/components/primary-asset-candidates.tsx': 2,
  'features/asset-dependencies/components/supporting-asset-candidates.tsx': 2,
  'features/compliance-assessments/components/compliance-assessments-page.tsx': 1,
  'features/controls/capability/components/capabilities-data-table.tsx': 1,
  'features/controls/capability/components/capability-validation-evidence.tsx': 3,
  'features/jobs/components/runs-page.tsx': 1,
  'features/mitre-attack/components/related-techniques-table.tsx': 1,
  'features/primary-assets/components/primary-assets-data-table.tsx': 2,
  'features/risk-scenarios/components/risk-scenario-findings.tsx': 2,
  'features/supporting-assets/components/supporting-asset-findings-section.tsx': 1,
  'features/threats/components/threat-cve-findings-tab.tsx': 1,
  'features/threats/components/threat-targets-tab.tsx': 1,
  'features/threats/components/threat-techniques-view.tsx': 1,
  'routes/_auth/$tenantId/{-$organizationId}/findings/cve/$cveId/assets.tsx': 1,
  'routes/_auth/$tenantId/{-$organizationId}/findings/index.tsx': 1,
  'routes/_auth/$tenantId/{-$organizationId}/findings/technique/$externalId/$expectationType/assets.tsx': 1,
};

const SRC = resolve(process.cwd(), 'src');
const USES_DATA_PAGE_LAYOUT = /from '(?:\.\.\/)*(?:components\/ui\/)?data-page-layout'|from '\.\/data-page-layout'/;
const PLAIN_SELECT = /<Select\b/g;

const listSources = (dir: string): Array<string> => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) {
    return listSources(path);
  }
  return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [path] : [];
});

const plainSelectCounts = (): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const path of listSources(SRC)) {
    const source = readFileSync(path, 'utf8');
    if (!USES_DATA_PAGE_LAYOUT.test(source)) {
      continue;
    }
    const count = source.match(PLAIN_SELECT)?.length ?? 0;
    if (count > 0) {
      counts[relative(SRC, path).split(sep).join('/')] = count;
    }
  }
  return counts;
};

describe('FilterPill ratchet', () => {
  it('should keep a plain Select out of every DataPageLayout list but the allowlisted ones, counts shrinking only', () => {
    expect(plainSelectCounts()).toEqual(PENDING);
  });
});
