import { describe, expect, it } from 'vitest';
import type { CapabilityFunction, EffectiveEdgeState } from '../controls/capability/constants';
import type { EffectiveEdge } from '../controls/capability/effective-coverage';
import type {
  FoldedValidationResults,
  PlatformFamilyControl,
  ValidationDerivationContext,
  ValidationDerivationInput,
  ValidationEvidenceRow,
} from './engine';
import { deriveControlValidation } from './engine';

const CAP_EDR = 'capability-edr';
const CAP_NDR = 'capability-ndr';
const CAP_ESP = 'capability-esp';
const CAP_MFA = 'capability-mfa';

const T1078 = 'technique-t1078';
const T1078_004 = 'technique-t1078-004';
const T1003 = 'technique-t1003';

const EXTERNAL_IDS = new Map([
  [T1078, 'T1078'],
  [T1078_004, 'T1078.004'],
  [T1003, 'T1003'],
]);

// XDR implements three controls, EDR only one: a result from an XDR platform therefore speaks for
// three controls at once, which is what makes attribution worth testing on its own.
const PLATFORM_CONTROLS: Array<PlatformFamilyControl> = [
  { platformTypeKey: 'XDR', capabilityId: CAP_EDR },
  { platformTypeKey: 'XDR', capabilityId: CAP_NDR },
  { platformTypeKey: 'XDR', capabilityId: CAP_ESP },
  { platformTypeKey: 'EDR', capabilityId: CAP_EDR },
];

const NOW = new Date('2026-08-19T12:00:00Z');
const DAY_MS = 86_400_000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);

const edge = (
  capabilityId: string,
  techniqueId: string,
  fn: CapabilityFunction = 'prevent',
  state: EffectiveEdgeState = 'recommended',
): EffectiveEdge => ({
  capabilityId,
  techniqueId,
  function: fn,
  source: state === 'added' ? 'tenant' : 'catalogue',
  state,
});

const row = (overrides: Partial<ValidationEvidenceRow> = {}): ValidationEvidenceRow => ({
  supportingAssetId: 'asset-1',
  mitreTechniqueId: T1078,
  parentTechniqueId: null,
  expectationType: 'prevention',
  securityPlatformType: 'XDR',
  sourceScenarioId: 'scenario-1',
  sourceSimulationId: 'simulation-1',
  evaluatedAt: daysAgo(1),
  runVerdict: 'dismissed',
  runAt: daysAgo(1),
  ...overrides,
});

const derive = (
  input: Partial<ValidationDerivationInput>,
  context: ValidationDerivationContext = { policy: { measuredValidityDays: null }, now: NOW },
) => deriveControlValidation({
  rows: [],
  edges: [],
  platformControls: PLATFORM_CONTROLS,
  techniqueExternalIds: EXTERNAL_IDS,
  ...input,
}, context);

const capabilityIds = (controls: ReturnType<typeof derive>): Array<string> =>
  controls.map((control) => control.capabilityId);

describe('control validation derivation', () => {
  describe('attribution', () => {
    it('marks every control the testing family implements and that covers the technique', () => {
      const controls = derive({
        rows: [row()],
        edges: [edge(CAP_EDR, T1078), edge(CAP_NDR, T1078), edge(CAP_ESP, T1078)],
      });

      expect(capabilityIds(controls)).toEqual([CAP_EDR, CAP_ESP, CAP_NDR]);
    });

    it('leaves out a control the family implements but whose coverage misses the technique', () => {
      const controls = derive({
        rows: [row()],
        edges: [edge(CAP_EDR, T1078), edge(CAP_NDR, T1003)],
      });

      expect(capabilityIds(controls)).toEqual([CAP_EDR]);
    });

    it('leaves out a control that covers the technique on the other function only', () => {
      const controls = derive({
        rows: [row({ expectationType: 'prevention' })],
        edges: [edge(CAP_EDR, T1078, 'detect')],
      });

      expect(controls).toEqual([]);
    });

    it('files a detection result in a detect cell', () => {
      const controls = derive({
        rows: [row({ expectationType: 'detection' })],
        edges: [edge(CAP_EDR, T1078, 'detect'), edge(CAP_EDR, T1078, 'prevent')],
      });

      expect(controls[0].cells).toEqual([expect.objectContaining({ function: 'detect' })]);
    });

    it('drops a result whose platform family is unknown', () => {
      const controls = derive({
        rows: [row({ securityPlatformType: 'unknown' }), row({ securityPlatformType: 'HOMEGROWN' })],
        edges: [edge(CAP_EDR, T1078)],
      });

      expect(controls).toEqual([]);
    });
  });

  describe('technique matching', () => {
    it('files a sub-technique result in the parent cell when only the parent is covered', () => {
      const controls = derive({
        rows: [row({ mitreTechniqueId: T1078_004, parentTechniqueId: T1078 })],
        edges: [edge(CAP_EDR, T1078)],
      });

      expect(controls[0].cells).toEqual([
        expect.objectContaining({ techniqueId: T1078, techniqueExternalId: 'T1078' }),
      ]);
    });

    it('prefers the exact sub-technique edge over the parent one', () => {
      const controls = derive({
        rows: [row({ mitreTechniqueId: T1078_004, parentTechniqueId: T1078 })],
        edges: [edge(CAP_EDR, T1078), edge(CAP_EDR, T1078_004)],
      });

      expect(controls[0].cells).toEqual([
        expect.objectContaining({ techniqueId: T1078_004, techniqueExternalId: 'T1078.004' }),
      ]);
    });
  });

  describe('tenant coverage edits', () => {
    it('stops attributing to an edge the tenant removed', () => {
      const controls = derive({
        rows: [row()],
        edges: [edge(CAP_EDR, T1078, 'prevent', 'removed')],
      });

      expect(controls).toEqual([]);
    });

    it('attributes to an edge the tenant added', () => {
      const controls = derive({
        rows: [row()],
        edges: [edge(CAP_EDR, T1078, 'prevent', 'added')],
      });

      expect(capabilityIds(controls)).toEqual([CAP_EDR]);
    });
  });

  describe('vote semantics', () => {
    it('counts one vote per scenario and contradicts the cell as soon as one voted so', () => {
      const controls = derive({
        rows: [
          row({ sourceScenarioId: 'scenario-1', runVerdict: 'dismissed' }),
          row({ sourceScenarioId: 'scenario-2', runVerdict: 'applicable' }),
        ],
        edges: [edge(CAP_EDR, T1078)],
      });

      expect(controls[0].cells[0]).toMatchObject({
        state: 'contradicted',
        validatedVotes: 1,
        totalVotes: 2,
      });
    });

    it('lets one asset that was walked through decide the whole scenario vote', () => {
      const controls = derive({
        rows: [
          row({ supportingAssetId: 'asset-1', runVerdict: 'dismissed' }),
          row({ supportingAssetId: 'asset-2', runVerdict: 'dismissed' }),
          row({ supportingAssetId: 'asset-3', runVerdict: 'applicable' }),
        ],
        edges: [edge(CAP_EDR, T1078)],
      });

      expect(controls[0].cells[0]).toMatchObject({
        state: 'contradicted',
        validatedVotes: 0,
        totalVotes: 1,
      });
    });

    it('validates the cell when every scenario held', () => {
      const controls = derive({
        rows: [
          row({ sourceScenarioId: 'scenario-1' }),
          row({ sourceScenarioId: 'scenario-2' }),
        ],
        edges: [edge(CAP_EDR, T1078)],
      });

      expect(controls[0].cells[0]).toMatchObject({
        state: 'validated',
        validatedVotes: 2,
        totalVotes: 2,
      });
    });

    it('votes a simulation that names no scenario as a single one-shot scenario', () => {
      const controls = derive({
        rows: [
          row({ sourceScenarioId: null, supportingAssetId: 'asset-1' }),
          row({ sourceScenarioId: null, supportingAssetId: 'asset-2' }),
        ],
        edges: [edge(CAP_EDR, T1078)],
      });

      expect(controls[0].cells[0]).toMatchObject({ totalVotes: 1, validatedVotes: 1 });
    });

    it('lets two scenario-less simulations vote apart, so one failure does not erase the other', () => {
      const controls = derive({
        rows: [
          row({ sourceScenarioId: null, sourceSimulationId: 'simulation-1' }),
          row({ sourceScenarioId: null, sourceSimulationId: 'simulation-2', runVerdict: 'applicable' }),
        ],
        edges: [edge(CAP_EDR, T1078)],
      });

      expect(controls[0].cells[0]).toMatchObject({ totalVotes: 2, validatedVotes: 1 });
    });

    it('keeps rows of one scenario-less simulation in a single vote', () => {
      const controls = derive({
        rows: [
          row({ sourceScenarioId: null, sourceSimulationId: 'simulation-1', supportingAssetId: 'asset-1' }),
          row({ sourceScenarioId: null, sourceSimulationId: 'simulation-1', supportingAssetId: 'asset-2' }),
        ],
        edges: [edge(CAP_EDR, T1078)],
      });

      expect(controls[0].cells[0]).toMatchObject({ totalVotes: 1, validatedVotes: 1 });
    });

    it('dates the cell on its latest counted result, not on whichever row was read first', () => {
      const controls = derive({
        rows: [
          row({ sourceScenarioId: 'scenario-1', evaluatedAt: daysAgo(30), runAt: daysAgo(30) }),
          row({ sourceScenarioId: 'scenario-2', evaluatedAt: daysAgo(3), runAt: daysAgo(3) }),
          row({ sourceScenarioId: 'scenario-3', evaluatedAt: daysAgo(12), runAt: daysAgo(12) }),
        ],
        edges: [edge(CAP_EDR, T1078)],
      });

      expect(controls[0].cells[0].latestProofAt).toEqual(daysAgo(3));
    });

    it('carries no date on a cell whose counted results were all undated', () => {
      const controls = derive({
        rows: [row({ evaluatedAt: null, runAt: null })],
        edges: [edge(CAP_EDR, T1078)],
      });

      expect(controls[0].cells[0].latestProofAt).toBeNull();
    });

    it('dates each function of one technique on its own results', () => {
      const controls = derive({
        rows: [
          row({ expectationType: 'prevention', evaluatedAt: daysAgo(20), runAt: daysAgo(20) }),
          row({ expectationType: 'detection', evaluatedAt: daysAgo(2), runAt: daysAgo(2) }),
        ],
        edges: [edge(CAP_EDR, T1078, 'prevent'), edge(CAP_EDR, T1078, 'detect')],
      });
      const dates = new Map(controls[0].cells.map((cell) => [cell.function, cell.latestProofAt]));

      expect(dates.get('prevent')).toEqual(daysAgo(20));
      expect(dates.get('detect')).toEqual(daysAgo(2));
    });
  });

  describe('measured validity window', () => {
    const policy = { measuredValidityDays: 30 };

    it('reverts a cell whose every result has aged out to never tested', () => {
      const controls = derive(
        {
          rows: [row({ evaluatedAt: daysAgo(90), runAt: daysAgo(90) })],
          edges: [edge(CAP_EDR, T1078)],
        },
        { policy, now: NOW },
      );

      expect(controls).toEqual([]);
    });

    it('keeps only the fresh rows in the ratio', () => {
      const controls = derive(
        {
          rows: [
            row({ sourceScenarioId: 'scenario-1', runVerdict: 'applicable', evaluatedAt: daysAgo(90), runAt: daysAgo(90) }),
            row({ sourceScenarioId: 'scenario-2', runVerdict: 'dismissed' }),
          ],
          edges: [edge(CAP_EDR, T1078)],
        },
        { policy, now: NOW },
      );

      expect(controls[0].cells[0]).toMatchObject({ state: 'validated', validatedVotes: 1, totalVotes: 1 });
    });

    it('counts a result of any age when the window is off', () => {
      const controls = derive({
        rows: [row({ evaluatedAt: daysAgo(900), runAt: daysAgo(900) })],
        edges: [edge(CAP_EDR, T1078)],
      });

      expect(controls[0].cells[0]).toMatchObject({ totalVotes: 1 });
    });

    it('reads the freshness off the later of the evaluation and the state change', () => {
      // The connector appends history only when the state flips, so a replay that changed nothing
      // leaves an old history date behind a recent evaluation.
      const controls = derive(
        {
          rows: [row({ evaluatedAt: daysAgo(1), runAt: daysAgo(400) })],
          edges: [edge(CAP_EDR, T1078)],
        },
        { policy, now: NOW },
      );

      expect(controls[0].cells[0]).toMatchObject({ totalVotes: 1 });
    });
  });

  describe('verdict source', () => {
    it('ignores a row no connector ever spoke about', () => {
      const controls = derive({
        rows: [row({ runVerdict: null, runAt: null })],
        edges: [edge(CAP_EDR, T1078)],
      });

      expect(controls).toEqual([]);
    });
  });

  describe('roll-ups', () => {
    it('contradicts the technique when either of its function cells was contradicted', () => {
      const controls = derive({
        rows: [
          row({ expectationType: 'prevention', runVerdict: 'dismissed' }),
          row({ expectationType: 'detection', runVerdict: 'applicable' }),
        ],
        edges: [edge(CAP_EDR, T1078, 'prevent'), edge(CAP_EDR, T1078, 'detect')],
      });

      expect(controls[0].summary).toMatchObject({
        testedTechniques: 1,
        validatedTechniques: 0,
        contradictedTechniques: 1,
      });
      expect(controls[0].state).toBe('contradicted');
    });

    it('counts each technique once and reports the latest proof', () => {
      const controls = derive({
        rows: [
          row({ mitreTechniqueId: T1078, evaluatedAt: daysAgo(5), runAt: daysAgo(5) }),
          row({ mitreTechniqueId: T1003, evaluatedAt: daysAgo(2), runAt: daysAgo(2), runVerdict: 'applicable' }),
        ],
        edges: [edge(CAP_EDR, T1078), edge(CAP_EDR, T1003)],
      });

      expect(controls[0].summary).toEqual({
        testedTechniques: 2,
        validatedTechniques: 1,
        contradictedTechniques: 1,
        latestProofAt: daysAgo(2),
      });
      expect(controls[0].state).toBe('contradicted');
    });

    it('validates the control when every cell held', () => {
      const controls = derive({
        rows: [row({ mitreTechniqueId: T1078 }), row({ mitreTechniqueId: T1003 })],
        edges: [edge(CAP_EDR, T1078), edge(CAP_EDR, T1003)],
      });

      expect(controls[0].state).toBe('validated');
      expect(controls[0].summary).toMatchObject({ validatedTechniques: 2, contradictedTechniques: 0 });
    });

    it('never reports a control nothing was attributed to', () => {
      const controls = derive({ rows: [row()], edges: [edge(CAP_MFA, T1003)] });

      expect(controls).toEqual([]);
    });
  });

  describe('folded results', () => {
    it('derives results folded across their assets as it derives their rows', () => {
      const rows = [
        row({ supportingAssetId: 'asset-1', evaluatedAt: daysAgo(3), runAt: daysAgo(3) }),
        row({ supportingAssetId: 'asset-2', runVerdict: 'applicable', evaluatedAt: daysAgo(1), runAt: daysAgo(2) }),
      ];
      const { supportingAssetId: _, ...shared } = rows[0];
      const folded: FoldedValidationResults = { ...shared, runVerdict: 'applicable', evaluatedAt: daysAgo(1), runAt: null };
      const edges = [edge(CAP_EDR, T1078)];

      expect(derive({ rows: [folded], edges })).toEqual(derive({ rows, edges }));
    });
  });
});
