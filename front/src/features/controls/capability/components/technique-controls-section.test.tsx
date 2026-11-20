/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { STRENGTH_BY_RUNG } from '@app/module/client';
import type { CapabilityAssessment, ResolvedPosture, TechniqueCapability } from '../types/capability';
import type { TechniqueControlTestReading } from '../types/validation';
import { renderWithTrpc } from '../../../../providers/trpc-test-harness';
import { TechniqueControlsSection } from './technique-controls-section';

const { openaevConnector, navigate, scopePosture } = vi.hoisted(() => ({ openaevConnector: vi.fn(), navigate: vi.fn(), scopePosture: vi.fn() }));

vi.mock('../hooks/use-scope-posture', () => ({ useScopePosture: scopePosture }));

vi.mock('../hooks/use-capability-validation', () => ({ useOpenaevConnector: () => openaevConnector() }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  useNavigate: () => (...args: Array<unknown>) => navigate(...args),
}));

vi.mock('../../../../components/shared', () => ({
  ControlIdPill: ({ externalId }: { externalId: string }) => <span>{externalId}</span>,
  SectionCard: ({ title, headerAction, children }: { title: string, headerAction?: ReactNode, children: ReactNode }) => (
    <section aria-label={title}>
      <header>{headerAction}</header>
      {children}
    </section>
  ),
}));

type Row = { id: string, externalId: string };

const TABLE = { getColumn: () => ({ getIsVisible: () => true }) };

interface FakeColumn {
  id: string,
  cell: (context: { row: { original: Row }, table: typeof TABLE }) => ReactElement,
}

vi.mock('../../../../components/ui/data-page-layout', () => ({
  DataPageLayout: ({ data, columns }: { data: Array<Row>, columns: Array<FakeColumn> }) => (
    <table>
      <tbody>
        {data.map((row) => (
          <tr key={row.id} aria-label={row.externalId}>
            {columns.map((column) => <td key={column.id}>{column.cell({ row: { original: row }, table: TABLE })}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const TECHNIQUE = { id: '00000000-0000-0000-0000-0000000000t1', externalId: 'T1055', name: 'Process Injection' };
const EDR_ID = 'edr';
const PAM_ID = 'pam';
const L2_L2 = { strengthRung: 'L2', coverageBucket: 'L2', strength: STRENGTH_BY_RUNG.L2, coverage: 0.7, phishingStage: null } as const;
/** L2 strength and L2 coverage on the engine's scale. */
const DECLARED = STRENGTH_BY_RUNG.L2 * 0.7;

const assessment = (strengthRung: CapabilityAssessment['strengthRung'], coverageBucket: CapabilityAssessment['coverageBucket']): CapabilityAssessment => ({
  strengthRung,
  coverageBucket,
  strengthMode: 'manual',
  coverageMode: 'manual',
  coverageBasis: 'declared',
  comment: null,
});

const control = (over: Partial<TechniqueCapability> & Pick<TechniqueCapability, 'id' | 'externalId'>): TechniqueCapability => ({
  name: over.externalId,
  function: 'prevent',
  source: 'catalogue',
  state: 'recommended',
  assessment: null,
  inheritedFrom: null,
  ...over,
});

const CONTROLS: Array<TechniqueCapability> = [
  control({ id: EDR_ID, externalId: 'EDR', assessment: assessment('L2', 'L2') }),
  control({ id: EDR_ID, externalId: 'EDR', function: 'detect', assessment: assessment('L2', 'L2') }),
  control({ id: PAM_ID, externalId: 'PAM' }),
];

const EDR_LABEL = { capabilityExternalId: 'EDR', capabilityName: 'EDR', capabilityRungs: { strengthRung: 'L2', coverageBucket: 'L2' } } as const;

const LOWERED: TechniqueControlTestReading = {
  covered: true,
  ...EDR_LABEL,
  capabilityId: EDR_ID,
  function: 'prevent',
  mitreTechniqueId: TECHNIQUE.id,
  familyTechniqueId: TECHNIQUE.id,
  parentEfficacy: null,
  declaration: L2_L2,
  declared: DECLARED,
  efficacy: DECLARED - 0.5 * (DECLARED - 0.1),
  tested: { tests: 10, heldTests: 1, rate: 0.1, hostsTested: 10, scopeHosts: 20, share: 0.5 },
};

const CONFIRMED: TechniqueControlTestReading = {
  covered: true,
  ...EDR_LABEL,
  capabilityId: EDR_ID,
  function: 'detect',
  mitreTechniqueId: TECHNIQUE.id,
  familyTechniqueId: TECHNIQUE.id,
  parentEfficacy: null,
  declaration: L2_L2,
  declared: DECLARED,
  efficacy: DECLARED,
  tested: { tests: 10, heldTests: 10, rate: 1, hostsTested: 10, scopeHosts: 20, share: 0.5 },
};

const READINGS: Array<TechniqueControlTestReading> = [
  LOWERED,
  { ...CONFIRMED, tested: null },
  {
    covered: true,
    capabilityId: PAM_ID,
    capabilityExternalId: 'PAM',
    capabilityName: 'PAM',
    capabilityRungs: null,
    function: 'prevent',
    mitreTechniqueId: TECHNIQUE.id,
    familyTechniqueId: TECHNIQUE.id,
    parentEfficacy: null,
    declaration: null,
    declared: 0,
    efficacy: 0,
    tested: null,
  },
];

/** Renders the section once the controls and the stored test readings have loaded. */
const renderSection = async (
  { organizationId, postures, isConnectorConfigured = true }: { organizationId?: string, postures?: Array<ResolvedPosture>, isConnectorConfigured?: boolean } = {},
  readings: Array<TechniqueControlTestReading> = READINGS,
  technique = TECHNIQUE,
  controls = CONTROLS,
) => {
  openaevConnector.mockReturnValue({ isConfigured: isConnectorConfigured, url: null });
  scopePosture.mockReturnValue({ organizationId, postures, isAwaitingScope: false });
  const { calls, queryClient } = renderWithTrpc(<TechniqueControlsSection technique={technique} />, {
    answers: {
      'controlCapabilities.getCapabilitiesForTechnique': controls,
      'controlValidation.getTechniqueTestReadings': readings,
    },
  });
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  await act(async () => {});
  return { calls };
};

/** What the fake server was asked, on a mutation of `controlCapabilities`. */
const mutationInputs = (calls: Array<{ path: string, input: unknown, type: string }>, procedure: string) =>
  calls.filter((call) => call.type === 'mutation' && call.path === `controlCapabilities.${procedure}`).map((call) => call.input);

const rowOf = (card: string, externalId: string): HTMLElement =>
  within(screen.getByRole('region', { name: card })).getByRole('row', { name: externalId });

describe('TechniqueControlsSection', () => {
  it('shows what OpenAEV observed and the engine efficacy beside the declaration', async () => {
    await renderSection();

    const row = rowOf('Prevented by', 'EDR');
    expect(within(row).getByText('1/10 tests succeeded (10%)')).toBeTruthy();
    expect(within(row).getByText('10/20 hosts tested (50%)')).toBeTruthy();
    expect(within(row).getByText('30%')).toBeTruthy();
    expect(within(row).getByText('Declared 50%')).toBeTruthy();
  });

  it('counts a detection result as detected, never as held', async () => {
    await renderSection({}, [CONFIRMED]);

    const row = rowOf('Detected by', 'EDR');
    expect(within(row).getByText('10/10 tests detected (100%)')).toBeTruthy();
    expect(within(row).queryByText(/held/)).toBeNull();
  });

  it('reads an untested control as not tested, on its declaration', async () => {
    await renderSection();

    const row = rowOf('Detected by', 'EDR');
    expect(within(row).getByText('Not tested')).toBeTruthy();
    expect(within(row).getByText('50%')).toBeTruthy();
    expect(within(row).getByText('Declared 50%')).toBeTruthy();
  });

  it('leaves an unassessed control\'s efficacy unassessed', async () => {
    await renderSection();

    const row = rowOf('Prevented by', 'PAM');
    expect(within(row).getByText('Not tested')).toBeTruthy();
    expect(within(row).getAllByText('Not assessed')).toHaveLength(2);
  });

  it('no longer shows the screens\' effectiveness, which reads on another scale', async () => {
    await renderSection();

    expect(within(rowOf('Prevented by', 'EDR')).queryByText(/59%/)).toBeNull();
  });

  it('asks the tenant level outside a scope, and the selected scope inside one', async () => {
    const tenantLevel = await renderSection();
    expect(tenantLevel.calls).toContainEqual(expect.objectContaining({
      path: 'controlValidation.getTechniqueTestReadings',
      input: { techniqueId: TECHNIQUE.id, organizationId: null },
    }));
    cleanup();

    const scoped = await renderSection({ organizationId: 'scope-1', postures: [] });
    expect(scoped.calls).toContainEqual(expect.objectContaining({
      path: 'controlValidation.getTechniqueTestReadings',
      input: { techniqueId: TECHNIQUE.id, organizationId: 'scope-1' },
    }));
  });

  it('reads a scope\'s result and efficacy as it hands them', async () => {
    await renderSection({ organizationId: 'scope-1', postures: [] }, [{
      ...LOWERED,
      efficacy: 0.4027,
      tested: { tests: 1, heldTests: 0, rate: 0, hostsTested: 1, scopeHosts: 5, share: 0.2 },
    }]);

    const row = rowOf('Prevented by', 'EDR');
    expect(within(row).getByText('0/1 test succeeded (0%)')).toBeTruthy();
    expect(within(row).getByText('1/5 hosts tested (20%)')).toBeTruthy();
    expect(within(row).getByText('40%')).toBeTruthy();
  });

  it('offers the explanation beside an assessed control\'s efficacy only', async () => {
    await renderSection();

    expect(within(rowOf('Prevented by', 'EDR')).getByRole('button', { name: 'How the engine efficacy of EDR on T1055 is computed' })).toBeTruthy();
    expect(within(rowOf('Prevented by', 'PAM')).queryByRole('button', { name: /How the engine efficacy/ })).toBeNull();
  });

  it('explains a lowered efficacy from the declaration, the result and the tested share', async () => {
    await renderSection();
    fireEvent.click(within(rowOf('Prevented by', 'EDR')).getByRole('button', { name: /How the engine efficacy/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('EDR · T1055 Process Injection · Prevention')).toBeTruthy();
    expect(within(dialog).getByText('Lowered by the tests')).toBeTruthy();
    expect(within(dialog).getByText('What was declared · 50%')).toBeTruthy();
    expect(within(dialog).getByText('What was tested · OpenAEV')).toBeTruthy();
    expect(within(dialog).getByText(
      'The declaration, 50%, drops because OpenAEV saw EDR fail 9 of the 10 tests, run on hosts that make up 50% of the estate.',
    )).toBeTruthy();
    expect(within(dialog).getByText('Stops the technique 72 times out of 100 where the control is in place.')).toBeTruthy();
    expect(within(dialog).getByText(/^The chance this control stops the technique/)).toBeTruthy();
    expect(within(dialog).getByText('72% × 70% ≈ 50%')).toBeTruthy();
    expect(within(dialog).getByText(/A single control is declared at 85% at most/)).toBeTruthy();
    expect(within(dialog).getByText('1/10 tests succeeded')).toBeTruthy();
    expect(within(dialog).getByText('10/20 hosts tested')).toBeTruthy();
    expect(within(dialog).getByText('These tests add up those run on T1055 and on each of its sub-techniques.')).toBeTruthy();
    expect(dialog.textContent).toContain('= 50% − 10% = 40%');
    expect(dialog.textContent).toContain('= 40% × 50% = 20%');
    expect(dialog.textContent).toContain('= 50% − 20% = 30%');
    expect(dialog.textContent).not.toMatch(/points?|pts/);
  });

  it('writes every line of the calculation in percent, exact on the figures shown, the weighting alone approximate: T1055, 2 held of 12 on half the estate', async () => {
    await renderSection({}, [{
      ...LOWERED,
      efficacy: DECLARED - 0.5 * (DECLARED - 2 / 12),
      tested: { tests: 12, heldTests: 2, rate: 2 / 12, hostsTested: 10, scopeHosts: 20, share: 0.5 },
    }]);
    const row = rowOf('Prevented by', 'EDR');
    expect(within(row).getByText('2/12 tests succeeded (17%)')).toBeTruthy();
    expect(within(row).getByText('34%')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: /How the engine efficacy/ }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('= 50% − 17% = 33%');
    expect(dialog.textContent).toContain('= 33% × 50% ≈ 16%');
    // The last line ends on the cell's own figure.
    expect(dialog.textContent).toContain('= 50% − 16% = 34%');
  });

  it('writes a calculation that rounds nowhere as plain equalities', async () => {
    await renderSection({}, [{
      ...LOWERED,
      declaration: { strengthRung: 'L2', coverageBucket: 'L1', strength: 0.5, coverage: 0.4, phishingStage: null },
      declared: 0.2,
      efficacy: 0.15,
    }]);
    fireEvent.click(within(rowOf('Prevented by', 'EDR')).getByRole('button', { name: /How the engine efficacy/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('50% × 40% = 20%')).toBeTruthy();
    expect(dialog.textContent).toContain('= 20% − 10% = 10%');
    expect(dialog.textContent).toContain('= 10% × 50% = 5%');
    expect(dialog.textContent).toContain('= 20% − 5% = 15%');
    expect(dialog.textContent).not.toContain('≈');
  });

  it('explains a confirmed efficacy as the declaration the tests did at least as well as', async () => {
    await renderSection({}, [CONFIRMED]);
    fireEvent.click(within(rowOf('Detected by', 'EDR')).getByRole('button', { name: /How the engine efficacy/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Confirmed by the tests')).toBeTruthy();
    expect(within(dialog).getByText(
      'OpenAEV saw EDR detect the technique in all 10 tests, at least as well as the declaration: the efficacy stays at 50%.',
    )).toBeTruthy();
    expect(within(dialog).getByText('10/10 tests detected')).toBeTruthy();
    expect(within(dialog).queryByText(/held/)).toBeNull();
    expect(dialog.textContent).toContain('= 50% − 100%: the tests do better, no gap');
    expect(dialog.textContent).toContain('= 0%');
    expect(dialog.textContent).toContain('= 50%, the declaration');
  });

  it('describes a detection efficacy as the strength of a signal, never as a chance of stopping the technique', async () => {
    await renderSection({}, [CONFIRMED]);
    fireEvent.click(within(rowOf('Detected by', 'EDR')).getByRole('button', { name: /How the engine efficacy/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/^How strongly this control signals the technique/)).toBeTruthy();
    expect(within(dialog).getByText('Strength of the signal it raises on the technique where the control is in place.')).toBeTruthy();
    expect(within(dialog).queryByText(/stops? the technique/i)).toBeNull();
  });

  it('explains an efficacy on an anchored phishing stage from the stage anchor, not the shared scale', async () => {
    const seg = 'seg';
    const PHISHING = { id: 't1566', externalId: 'T1566', name: 'Phishing' };
    const declared = 0.97 * 0.7;
    await renderSection({}, [{
      ...LOWERED,
      capabilityId: seg,
      capabilityExternalId: 'SEG',
      capabilityName: 'SEG',
      mitreTechniqueId: PHISHING.id,
      familyTechniqueId: PHISHING.id,
      declaration: { strengthRung: 'L2', coverageBucket: 'L2', strength: 0.97, coverage: 0.7, phishingStage: 'delivery' },
      declared,
      efficacy: declared - 0.5 * (declared - 0.5),
      tested: { tests: 2, heldTests: 1, rate: 0.5, hostsTested: 10, scopeHosts: 20, share: 0.5 },
    }], PHISHING);
    fireEvent.click(within(rowOf('Prevented by', 'SEG')).getByRole('button', { name: /How the engine efficacy of SEG/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('What was declared · 68%')).toBeTruthy();
    expect(within(dialog).getByText('Stage anchor for Intermediate')).toBeTruthy();
    expect(within(dialog).getByText('Applies at the email\'s delivery, in place of the shared strength scale.')).toBeTruthy();
    expect(within(dialog).getByText('97% × 70% ≈ 68%')).toBeTruthy();
    expect(within(dialog).getByText(/^At its phishing stage the engine reads SEG at a value set per strength rung for that stage/)).toBeTruthy();
    expect(within(dialog).queryByText(/A single control is declared at/)).toBeNull();
    expect(within(dialog).queryByText(/^Strength /)).toBeNull();
    expect(dialog.textContent).toContain('= 68% − 50% = 18%');
    expect(dialog.textContent).toContain('= 18% × 50% = 9%');
    expect(dialog.textContent).toContain('= 68% − 9% = 59%');
  });

  it('explains an untested efficacy as the declaration, with no tested terms', async () => {
    await renderSection();
    fireEvent.click(within(rowOf('Detected by', 'EDR')).getByRole('button', { name: /How the engine efficacy/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText('Not tested')).toHaveLength(1);
    expect(within(dialog).getByText('OpenAEV has not tested EDR on this technique, so the efficacy is the declaration, 50%.')).toBeTruthy();
    expect(within(dialog).queryByText('What was tested · OpenAEV')).toBeNull();
  });

  describe('a sub-technique', () => {
    const SUB_TECHNIQUE = { id: 'sub', externalId: 'T1055.012', name: 'Process Hollowing' };
    const OWN: TechniqueControlTestReading = {
      ...LOWERED,
      tested: { tests: 2, heldTests: 0, rate: 0, hostsTested: 2, scopeHosts: 20, share: 0.1 },
      efficacy: DECLARED * 0.9,
      parentEfficacy: LOWERED.efficacy,
    };
    const openDialog = () => {
      fireEvent.click(within(rowOf('Prevented by', 'EDR')).getByRole('button', { name: /How the engine efficacy of EDR/ }));
      return screen.getByRole('dialog');
    };

    it('reads its own tests and efficacy', async () => {
      await renderSection({}, [OWN], SUB_TECHNIQUE);

      const row = rowOf('Prevented by', 'EDR');
      expect(within(row).getByText('0/2 tests succeeded (0%)')).toBeTruthy();
      expect(within(row).getByText('2/20 hosts tested (10%)')).toBeTruthy();
      expect(within(row).getByText('45%')).toBeTruthy();
    });

    it('names in its dialog the parent the engine prices, and the control\'s efficacy there', async () => {
      await renderSection({}, [OWN], SUB_TECHNIQUE);

      expect(within(openDialog()).getByText('The engine prices T1055, where this control reads 30%.')).toBeTruthy();
    });

    it('names no parent where the control does not cover it, nor on a technique\'s own page', async () => {
      await renderSection({}, [{ ...OWN, parentEfficacy: null }], SUB_TECHNIQUE);
      expect(within(openDialog()).queryByText(/The engine prices/)).toBeNull();
      cleanup();

      await renderSection();
      expect(within(openDialog()).queryByText(/The engine prices/)).toBeNull();
    });

    it('reads as not tested, on its declaration, without tests of its own', async () => {
      await renderSection({}, [{ ...OWN, tested: null, efficacy: DECLARED }], SUB_TECHNIQUE);

      const row = rowOf('Prevented by', 'EDR');
      expect(within(row).getByText('Not tested')).toBeTruthy();
      expect(within(row).getByText('50%')).toBeTruthy();
    });

    it('confirms a result its whole percent leaves at the declaration, and says only what was tested: T1055.012, 1 held of 2 on 2 hosts of 20', async () => {
      const tested = { tests: 2, heldTests: 1, rate: 0.5, hostsTested: 2, scopeHosts: 20, share: 0.1 };
      await renderSection({}, [{ ...OWN, tested, efficacy: DECLARED - 0.1 * (DECLARED - 0.5) }], SUB_TECHNIQUE);

      const row = rowOf('Prevented by', 'EDR');
      expect(within(row).getByText('50%').getAttribute('style')).toBeNull();
      expect(within(row).getByText('Declared 50%')).toBeTruthy();
      const dialog = openDialog();
      expect(within(dialog).getByText('Confirmed by the tests')).toBeTruthy();
      expect(within(dialog).getByText('OpenAEV saw EDR hold in 1 of the 2 tests, on hosts making up 10% of the estate: the efficacy stays at 50%.')).toBeTruthy();
      expect(within(dialog).queryByText(/at least as well/)).toBeNull();
      expect(within(dialog).queryByText('Lowered by the tests')).toBeNull();
      expect(dialog.textContent).toContain('= 50% − 50% = 0%');
      expect(dialog.textContent).not.toContain('do better');
      expect(dialog.textContent).toContain('= 50%, the declaration');
    });
  });

  describe('a control the engine does not read on the technique', () => {
    const FAILED = { tests: 1, heldTests: 0, rate: 0, hostsTested: 1, scopeHosts: 20, share: 0.05 };
    const XDR: TechniqueControlTestReading = {
      covered: false,
      capabilityId: 'xdr',
      capabilityExternalId: 'XDR',
      capabilityName: 'Extended Detection and Response',
      capabilityRungs: { strengthRung: 'L2', coverageBucket: 'L1' },
      function: 'prevent',
      mitreTechniqueId: TECHNIQUE.id,
      familyTechniqueId: TECHNIQUE.id,
      tested: FAILED,
    };

    it('lists a control only tested there after the covering ones, its result shown and a warning with the way to declare it', async () => {
      await renderSection({}, [...READINGS, XDR]);

      const card = screen.getByRole('region', { name: 'Prevented by' });
      expect(within(card).getAllByRole('row').map((row) => row.getAttribute('aria-label'))).toEqual(['EDR', 'PAM', 'XDR']);
      const row = rowOf('Prevented by', 'XDR');
      expect(within(row).getByText('0/1 test succeeded (0%)')).toBeTruthy();
      expect(within(row).getByText('Not declared')).toBeTruthy();
      expect(within(row).queryByText(/Declared \d/)).toBeNull();
      expect(within(rowOf('Prevented by', 'EDR')).queryByRole('button', { name: /Declare on/ })).toBeNull();
    });

    it('declares it on the control where the reader is, without leaving the page', async () => {
      const { calls } = await renderSection({}, [XDR]);

      fireEvent.click(within(rowOf('Prevented by', 'XDR')).getByRole('button', { name: 'Declare on XDR' }));

      await waitFor(() => expect(mutationInputs(calls, 'addTechniqueOverride')).toEqual([{ capabilityId: 'xdr', techniqueId: TECHNIQUE.id, function: 'prevent' }]));
      expect(mutationInputs(calls, 'restoreTechnique')).toEqual([]);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('restores a technique the control had unlinked rather than adding it again', async () => {
      const { calls } = await renderSection({}, [XDR], TECHNIQUE, [control({ id: 'xdr', externalId: 'XDR', state: 'removed', assessment: assessment('L2', 'L1') })]);

      fireEvent.click(within(rowOf('Prevented by', 'XDR')).getByRole('button', { name: 'Declare on XDR' }));

      await waitFor(() => expect(mutationInputs(calls, 'restoreTechnique')).toEqual([{ capabilityId: 'xdr', techniqueId: TECHNIQUE.id, function: 'prevent' }]));
      expect(mutationInputs(calls, 'addTechniqueOverride')).toEqual([]);
    });

    it('unlinks a control the technique is linked to, where the reader is', async () => {
      const { calls } = await renderSection();

      fireEvent.click(within(rowOf('Prevented by', 'EDR')).getByRole('button', { name: 'Unlink' }));

      await waitFor(() => expect(mutationInputs(calls, 'removeTechnique')).toEqual([{ capabilityId: EDR_ID, techniqueId: TECHNIQUE.id, function: 'prevent' }]));
      expect(navigate).not.toHaveBeenCalled();
    });

    it('offers no unlink on a link the parent carries, which is unlinked there', async () => {
      const parent = { id: 'parent', externalId: 'T1055', name: 'Process Injection' };
      await renderSection({}, [], { id: 'sub', externalId: 'T1055.012', name: 'Process Hollowing' }, [
        control({ id: EDR_ID, externalId: 'EDR', assessment: assessment('L2', 'L2'), inheritedFrom: parent }),
      ]);

      expect(within(rowOf('Prevented by', 'EDR')).queryByRole('button', { name: 'Unlink' })).toBeNull();
    });

    it('links back an untested control the technique was unlinked from, by restoring it', async () => {
      const { calls } = await renderSection({}, [], TECHNIQUE, [control({ id: PAM_ID, externalId: 'PAM', state: 'removed' })]);

      fireEvent.click(within(rowOf('Prevented by', 'PAM')).getByRole('button', { name: 'Link' }));

      await waitFor(() => expect(mutationInputs(calls, 'restoreTechnique')).toEqual([{ capabilityId: PAM_ID, techniqueId: TECHNIQUE.id, function: 'prevent' }]));
      expect(mutationInputs(calls, 'addTechniqueOverride')).toEqual([]);
    });

    it('offers no link back on a link the parent carries and was unlinked from, which is relinked there', async () => {
      const parent = { id: 'parent', externalId: 'T1055', name: 'Process Injection' };
      await renderSection({}, [], { id: 'sub', externalId: 'T1055.012', name: 'Process Hollowing' }, [
        control({ id: PAM_ID, externalId: 'PAM', state: 'removed', inheritedFrom: parent }),
      ]);

      expect(within(rowOf('Prevented by', 'PAM')).queryByRole('button', { name: 'Link' })).toBeNull();
    });

    it('offers no declaration, in the row nor in its dialog, on a tested link the parent carries and was unlinked from', async () => {
      const SUB_TECHNIQUE = { id: 'sub', externalId: 'T1055.012', name: 'Process Hollowing' };
      const inherited = control({
        id: 'xdr',
        externalId: 'XDR',
        state: 'removed',
        assessment: assessment('L2', 'L1'),
        inheritedFrom: { id: TECHNIQUE.id, externalId: TECHNIQUE.externalId, name: TECHNIQUE.name },
      });
      await renderSection({}, [{ ...XDR, mitreTechniqueId: SUB_TECHNIQUE.id }], SUB_TECHNIQUE, [inherited]);

      expect(within(rowOf('Prevented by', 'XDR')).getByText('Not declared')).toBeTruthy();
      expect(within(rowOf('Prevented by', 'XDR')).queryByRole('button', { name: 'Declare on XDR' })).toBeNull();
      fireEvent.click(within(rowOf('Prevented by', 'XDR')).getByRole('button', { name: /How the engine efficacy/ }));
      expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Declare on XDR' })).toBeNull();
    });

    it('counts the controls covering the technique on each card, and the ones only listed there apart', async () => {
      await renderSection({}, [...READINGS, XDR, { ...XDR, capabilityId: 'swg', capabilityExternalId: 'SWG' }]);

      expect(within(screen.getByRole('region', { name: 'Prevented by' })).getByText('2 + 2 not covered')).toBeTruthy();
      expect(within(screen.getByRole('region', { name: 'Detected by' })).getByText('1')).toBeTruthy();
      cleanup();

      await renderSection({}, [...READINGS, XDR]);
      expect(within(screen.getByRole('region', { name: 'Prevented by' })).getByText('2 + 1 not covered')).toBeTruthy();
    });

    it('explains it with what was tested and why the engine does not count it, leading to those tests and offering to declare it', async () => {
      const { calls } = await renderSection({}, [XDR]);
      fireEvent.click(within(rowOf('Prevented by', 'XDR')).getByRole('button', { name: /How the engine efficacy of XDR/ }));

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('XDR does not cover this technique, so the engine does not count these tests.')).toBeTruthy();
      expect(within(dialog).getByText('What was tested · OpenAEV')).toBeTruthy();
      expect(within(dialog).queryByText('The calculation')).toBeNull();
      expect(within(dialog).getByRole('button', { name: 'See the tests in XDR › Validation' })).toBeTruthy();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Declare on XDR' }));
      await waitFor(() => expect(mutationInputs(calls, 'addTechniqueOverride')).toEqual([{ capabilityId: 'xdr', techniqueId: TECHNIQUE.id, function: 'prevent' }]));
    });

    it('names the parent the engine prices on a sub-technique the control covers alone', async () => {
      await renderSection({}, [{ ...XDR, capabilityId: EDR_ID, ...EDR_LABEL }], { id: 'sub', externalId: 'T1055.012', name: 'Process Hollowing' });
      fireEvent.click(within(rowOf('Prevented by', 'EDR')).getByRole('button', { name: /How the engine efficacy of EDR/ }));

      expect(within(screen.getByRole('dialog')).getByText('The engine prices T1055, which EDR does not cover, so it does not count these tests.')).toBeTruthy();
    });
  });

  describe('the way to the evidence', () => {
    const openDialog = (card: string) => {
      fireEvent.click(within(rowOf(card, 'EDR')).getByRole('button', { name: /How the engine efficacy of EDR/ }));
      return screen.getByRole('dialog');
    };

    it('should lead a tested result to the control\'s evidence on the technique, sub-techniques included', async () => {
      await renderSection();

      fireEvent.click(within(openDialog('Prevented by')).getByRole('button', { name: 'See the tests in EDR › Validation' }));

      expect(navigate).toHaveBeenCalledWith({
        from: '/$tenantId/{-$organizationId}',
        to: 'controls/$controlId/validation',
        params: { controlId: EDR_ID },
        search: { technique: 'T1055' },
      });
    });

    it('should lead a sub-technique\'s page to its parent\'s evidence, which its result is', async () => {
      await renderSection({}, [{ ...LOWERED, familyTechniqueId: 'parent-t1055' }], { id: 'sub', externalId: 'T1055.012', name: 'Process Hollowing' });

      fireEvent.click(within(openDialog('Prevented by')).getByRole('button', { name: 'See the tests in EDR › Validation' }));

      expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ search: { technique: 'T1055' } }));
    });

    it('should offer none without a result', async () => {
      await renderSection();

      expect(within(openDialog('Detected by')).queryByRole('button', { name: /See the tests/ })).toBeNull();
    });

    it('should offer none without an OpenAEV connector, the result shown all the same', async () => {
      await renderSection({ isConnectorConfigured: false });

      expect(within(openDialog('Prevented by')).queryByRole('button', { name: /See the tests/ })).toBeNull();
    });
  });
});
