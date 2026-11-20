import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeConfig, normalizePath } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

const publicDir = normalizePath(resolve(dirname(fileURLToPath(import.meta.url)), 'public'));

// These files fail when they share a worker's module registry with the files run before them:
// a `vi.mock` or a React context of one file leaks into the next.
const ISOLATED_TESTS = [
  'src/components/layout/main-layout/fds-navbar/nav-items.test.tsx',
  'src/components/layout/main-layout/fds-navbar/navbar-sections.test.tsx',
  'src/components/shared/column-graph.test.tsx',
  'src/components/shared/ttp-matrix-view.test.tsx',
  'src/features/asset-dependencies/components/dependency-graph-card.test.tsx',
  'src/features/asset-dependencies/components/dependency-graph-link-card.test.tsx',
  'src/features/asset-dependencies/components/dependency-graph-panel.test.tsx',
  'src/features/asset-dependencies/components/dependency-graph.test.tsx',
  'src/features/asset-dependencies/components/manage-dependencies-drawer.test.tsx',
  'src/features/asset-dependencies/components/primary-asset-dependencies-tab.test.tsx',
  'src/features/budget-reviews/components/budget-review-edit-drawer.test.tsx',
  'src/features/budget-reviews/components/budget-review-identity-card.test.tsx',
  'src/features/budget-reviews/components/budget-review-tolerance-section.test.tsx',
  'src/features/compliance-assessments/components/compliance-answer-drawer.test.tsx',
  'src/features/controls/capability/components/capability-techniques-matrix.test.tsx',
  'src/features/controls/capability/components/capability-validation-evidence.test.tsx',
  'src/features/controls/capability/components/technique-controls-section.test.tsx',
  'src/features/controls/capability/hooks/use-scope-posture.test.ts',
  'src/features/dashboard/components/loss-exceedance-chart.test.tsx',
  'src/features/finding-score/ui/score-explanation/score-explanation-dialog.test.tsx',
  'src/features/finding-score/ui/score-history-lifeline.test.tsx',
  'src/features/jobs/components/job-overview-panel.test.tsx',
  'src/features/jobs/components/run-detail-page.test.tsx',
  'src/features/mitre-attack/components/mitre-description.test.tsx',
  'src/features/onboarding/components/asset-source-tiles.test.tsx',
  'src/features/onboarding/components/company-step.test.tsx',
  'src/features/onboarding/components/defender-source-drawer.test.tsx',
  'src/features/onboarding/components/defense-source-tiles.test.tsx',
  'src/features/onboarding/components/drata-source-drawer.test.tsx',
  'src/features/onboarding/components/finances-step.test.tsx',
  'src/features/onboarding/components/get-started-done.test.tsx',
  'src/features/onboarding/components/get-started-page.test.tsx',
  'src/features/onboarding/components/onboarding-stepper.test.tsx',
  'src/features/onboarding/components/opencti-source-drawer.test.tsx',
  'src/features/onboarding/components/protect-assets-graph.test.tsx',
  'src/features/onboarding/components/protect-step.test.tsx',
  'src/features/onboarding/components/protect-templates.test.tsx',
  'src/features/onboarding/components/scenarios-step.test.tsx',
  'src/features/onboarding/components/self-assessment-drawer.test.tsx',
  'src/features/onboarding/components/threat-source-tiles.test.tsx',
  'src/features/onboarding/components/tolerance-step.test.tsx',
  'src/features/risk-scenarios/components/crq-run-history.test.tsx',
  'src/features/risk-scenarios/components/crq-simulation-results.test.tsx',
  'src/features/risk-scenarios/components/loss-estimates-drawer.test.tsx',
  'src/features/risk-scenarios/components/overview/findings-summary-card.test.tsx',
  'src/features/risk-scenarios/components/overview/most-active-threats-card.test.tsx',
  'src/features/risk-scenarios/components/risk-scenario-relevant-threats.test.tsx',
  'src/features/risk-scenarios/components/risk-scenario-targets.test.tsx',
  'src/features/supporting-assets/components/asset-events.test.tsx',
  'src/features/supporting-assets/components/asset-posture-lifeline-card.test.tsx',
  'src/features/supporting-assets/components/crq-posture-tile.test.tsx',
  'src/features/supporting-assets/components/supporting-asset-ttps.test.tsx',
  'src/features/supporting-assets/components/technique-score-dialog.test.tsx',
  'src/features/threat-event-frequency/components/threat-event-frequency-page.test.tsx',
  'src/features/threats/components/matching-outcome-table.test.tsx',
  'src/features/threats/components/relevance-proof-panel.test.tsx',
  'src/features/threats/components/threat-attribution-graph.test.tsx',
  'src/features/threats/components/threat-attributions-table.test.tsx',
  'src/features/threats/components/threat-concerns-you-card.test.tsx',
  'src/features/threats/components/threat-cve-findings-tab.test.tsx',
  'src/features/threats/components/threat-hero.test.tsx',
  'src/features/threats/components/threat-list-table.test.tsx',
  'src/features/threats/components/threat-outcomes-table.test.tsx',
  'src/features/threats/components/threat-targets-tab.test.tsx',
  'src/features/threats/components/threat-techniques-view.test.tsx',
  'src/features/threats/components/threat-ttps-tab.test.tsx',
  'src/features/treatment-plans/components/treatment-plan-scenarios-card.test.tsx',
  'src/features/treatment-plans/components/treatment-plans-data-table.test.tsx',
  'src/features/unique-cve-finding/ui/cve-scenarios-card.test.tsx',
  'src/features/unique-cve-finding/ui/unique-score-lifeline.test.tsx',
  'src/features/xtm-one/components/ask-ariane.test.tsx',
  'src/features/xtm-one/components/xtm-one-registration-toast.test.tsx',
  'src/features/xtm/xtm-counterparts.test.tsx',
  'src/hooks/utils/use-copy-to-clipboard.test.ts',
  'src/hooks/utils/use-reader-time-zone.test.ts',
  'src/stores/client-report-queue.test.ts',
  'src/stores/onboarding-seen-collection.test.ts',
  'src/stores/xtm-sign-out-collection.test.ts',
];

export default mergeConfig(viteConfig, defineConfig({
  resolve: {
    // A public asset imported at the site root (`import logo from '/logo.svg'`) has no module to
    // resolve to, and the `file:///logo.svg` vitest falls back to is not an absolute path on Windows.
    alias: [{ find: /^\/([\w-]+\.(?:svg|png|jpe?g|webp|ico))$/, replacement: `${publicDir}/$1` }],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Transpiling this workspace is 28% of its test time and is redone on every run. The cache is
    // keyed on each module's own content and is dropped whole when the lockfile moves.
    fsModuleCache: true,
    // Vitest externalises bare dependencies to Node by default, which cannot resolve the .css
    // imports @filigran/ui and @uiw/react-md-editor (with its markdown preview) ship. Inlining
    // routes them through Vite, which can.
    server: { deps: { inline: [/@filigran\/ui/, /@uiw\//] } },
    // A fresh jsdom and module registry per file is 80% of this workspace's test time, so every
    // file that tolerates it shares its worker's.
    projects: [
      { extends: true, test: { name: 'isolated', include: ISOLATED_TESTS, isolate: true } },
      {
        extends: true,
        test: { name: 'shared', exclude: [...configDefaults.exclude, ...ISOLATED_TESTS], isolate: false },
      },
    ],
  },
}));
