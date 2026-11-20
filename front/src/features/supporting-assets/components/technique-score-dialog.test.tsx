/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type * as Router from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TechniqueScoreCell, TechniqueScoreFinding } from './technique-scores-utils';
import { NEVER, renderWithTrpc } from '../../../providers/trpc-test-harness';
import { TechniqueScoreDialog } from './technique-score-dialog';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof Router>(),
  Link: ({ children }: { children: ReactNode }) => <a href="#link">{children}</a>,
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const READER: TechniqueScoreFinding = {
  evidenceId: 'reader',
  cveId: 'CVE-2021-41773',
  cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N',
  epss: 0.94,
  knownExploited: true,
  access: 1,
  threat: 0.96,
  impact: 0.61,
};

const BYSTANDER: TechniqueScoreFinding = { ...READER, evidenceId: 'bystander', cveId: 'CVE-2099-0001' };

const CELL: TechniqueScoreCell = {
  mitreTechniqueId: 't1190',
  externalId: 'T1190',
  name: 'Exploit Public-Facing Application',
  score: 59,
  evidenceId: 'reader',
  source: 'finding',
  lane: 'topology',
};

const SUSCEPTIBILITY_CELL: TechniqueScoreCell = {
  mitreTechniqueId: 't1566',
  externalId: 'T1566',
  name: 'Phishing',
  score: 13,
  evidenceId: null,
  source: 'susceptibility',
  lane: null,
  susceptibility: { declared: true, expired: false, measuredOn: '2026-09-01', rate: 0.126 },
};

const RUN_AT = new Date('2026-09-24T10:00:00Z');

const NEVER_TESTED = { here: null, fleet: null, platforms: [] };

const TESTED = {
  prevention: {
    here: { held: 23, total: 100 },
    fleet: { held: 412, total: 1380 },
    platforms: [
      { securityPlatformType: 'NDR', held: 18, total: 40, lastRunAt: RUN_AT },
      { securityPlatformType: 'EDR', held: 5, total: 40, lastRunAt: RUN_AT },
      { securityPlatformType: 'XDR', held: 0, total: 20, lastRunAt: null },
    ],
  },
  detection: NEVER_TESTED,
};

const DETAIL_PATH = 'findingScore.getAssetTechniqueTestDetail';

/** Opens the dialog and returns it once the OpenAEV results read has settled. */
const openDialog = async (
  cell: TechniqueScoreCell | null = CELL,
  findings: Array<TechniqueScoreFinding> = [READER, BYSTANDER],
  detail: object = { prevention: NEVER_TESTED, detection: NEVER_TESTED },
): Promise<HTMLElement> => {
  const { queryClient } = renderWithTrpc(
    <TechniqueScoreDialog
      technique={{ id: 't1190', externalId: 'T1190', name: 'Exploit Public-Facing Application', scores: cell }}
      supportingAssetId="00000000-0000-0000-0000-0000000000a1"
      findingsById={new Map(findings.map((finding) => [finding.evidenceId, finding]))}
      onClose={() => {}}
    />,
    { answers: { [DETAIL_PATH]: detail } },
  );
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  return screen.getByRole('dialog');
};

describe('the dialog of a scored cell', () => {
  it('gives the technique its one gauge and the finding holding it, and no other', async () => {
    const dialog = await openDialog();
    expect(within(dialog).getByLabelText('Score: 59 out of 100, Medium band')).toBeTruthy();
    expect(dialog.textContent).toContain('CVE-2021-41773');
    expect(dialog.textContent).toContain('Read from the CVSS vector');
    expect(dialog.textContent).not.toContain('CVE-2099-0001');
  });

  it('shows the three terms the score multiplies', async () => {
    const dialog = await openDialog();
    expect(within(dialog).getByLabelText('Vector access: 100 out of 100, Critical band')).toBeTruthy();
    expect(within(dialog).getByLabelText('Threat: 96 out of 100, Critical band')).toBeTruthy();
    expect(within(dialog).getByLabelText('Impact: 61 out of 100, Medium band')).toBeTruthy();
  });

  it('states what the opening rests on, the threat damped by complexity included', async () => {
    expect((await openDialog()).textContent).toContain('AV:N · PR:N · UI:N · EPSS 0.940 · CISA KEV');
    cleanup();
    const damped: TechniqueScoreFinding = { ...READER, cvssVector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H', epss: 0.152, knownExploited: false };
    expect((await openDialog(CELL, [damped])).textContent).toContain('EPSS 0.152 · high attack complexity');
  });

  it('names 4.0 attack requirements present as such, never as a high complexity', async () => {
    const requirements: TechniqueScoreFinding = { ...READER, cvssVector: 'CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N' };
    const text = (await openDialog(CELL, [requirements])).textContent;
    expect(text).toContain('attack requirements present');
    expect(text).not.toContain('high attack complexity');
  });

  it('still links the holding finding when the read could not describe it', async () => {
    const dialog = await openDialog(CELL, []);
    expect(within(dialog).getByText('reader')).toBeTruthy();
  });
});

describe('the dialog of a cell no finding opens', () => {
  it('draws an empty gauge and says there is no finding', async () => {
    const dialog = await openDialog(null, [], TESTED);
    expect(within(dialog).getByLabelText('Score: no finding')).toBeTruthy();
    expect(within(dialog).getByText('No finding')).toBeTruthy();
  });
});

describe('the dialog of a susceptibility cell', () => {
  const openSusceptibility = async (cell: TechniqueScoreCell = SUSCEPTIBILITY_CELL): Promise<HTMLElement> => {
    const { queryClient } = renderWithTrpc(
      <TechniqueScoreDialog
        technique={{ id: 't1566', externalId: 'T1566', name: 'Phishing', scores: cell }}
        supportingAssetId="00000000-0000-0000-0000-0000000000a1"
        findingsById={new Map([[READER.evidenceId, READER]])}
        onClose={() => {}}
      />,
      { answers: { [DETAIL_PATH]: { prevention: NEVER_TESTED, detection: NEVER_TESTED } } },
    );
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    return screen.getByRole('dialog');
  };

  it('shows the declared rate and the day it was measured, and no finding link', async () => {
    const dialog = await openSusceptibility();
    expect(within(dialog).getByLabelText('Score: 13 out of 100, Low band')).toBeTruthy();
    expect(dialog.textContent).toContain('12.6 %');
    expect(dialog.textContent).not.toContain('13 %');
    expect(dialog.textContent).toContain('Sep 1, 2026');
    expect(within(dialog).queryByRole('link')).toBeNull();
    expect(dialog.textContent).not.toContain('No finding');
    expect(dialog.textContent).not.toContain('CVE-2021-41773');
  });

  it('names the default value when no simulation rate is declared', async () => {
    const dialog = await openSusceptibility({ ...SUSCEPTIBILITY_CELL, score: 7, susceptibility: { declared: false, expired: false, measuredOn: null, rate: 0.07 } });
    expect(dialog.textContent).toContain('7 %');
    expect(dialog.textContent).toContain('No simulation rate is declared, so this is the default.');
    expect(dialog.textContent).not.toContain('Lain');
    expect(dialog.textContent).not.toContain('Sep 1, 2026');
  });

  it('names the expired simulation and reads the default in its place', async () => {
    const dialog = await openSusceptibility({ ...SUSCEPTIBILITY_CELL, score: 7, susceptibility: { declared: false, expired: true, measuredOn: '2026-09-01', rate: 0.07 } });
    expect(dialog.textContent).toContain('7 %');
    expect(dialog.textContent).toContain('The phishing simulation measured on Sep 1, 2026 is older than the validity of a test result');
    expect(dialog.textContent).not.toContain('were caught');
  });

  it('says the controls are not counted here and where their effect reads', async () => {
    expect((await openSusceptibility()).textContent).toContain('Controls are not counted here: their effect is read on the Controls tab of a risk scenario.');
  });
});

describe('the prevention and detection sections', () => {
  it('reads the ratio on this asset beside the fleet ratio', async () => {
    const dialog = await openDialog(CELL, [READER], TESTED);
    expect(within(dialog).getByLabelText('Prevention: prevented 23/100 on this asset')).toBeTruthy();
    expect(dialog.textContent).toContain('Fleet: prevented 412/1380');
  });

  it('lists one row per platform family, whose ratios add up to the section', async () => {
    const dialog = await openDialog(CELL, [READER], TESTED);
    const rows = within(dialog).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual(['NDR', 'EDR', 'XDR']);
    const ratios = rows.map((row) => within(row).getAllByRole('cell')[2].textContent.split('/').map(Number));
    expect(ratios.reduce((sum, [held]) => sum + held, 0)).toBe(23);
    expect(ratios.reduce((sum, [, total]) => sum + total, 0)).toBe(100);
    expect(dialog.textContent).toContain('View the 100 results');
  });

  it('says the results are loading rather than never tested while the read is pending', () => {
    renderWithTrpc(
      <TechniqueScoreDialog
        technique={{ id: 't1190', externalId: 'T1190', name: 'Exploit Public-Facing Application', scores: null }}
        supportingAssetId="00000000-0000-0000-0000-0000000000a1"
        findingsById={new Map()}
        onClose={() => {}}
      />,
      { answers: { [DETAIL_PATH]: NEVER } },
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Loading the OpenAEV results')).toBeTruthy();
    expect(within(dialog).queryByText('Never tested here')).toBeNull();
  });

  it('says a type was never tested here rather than draw a zero', async () => {
    const dialog = await openDialog(CELL, [READER], TESTED);
    expect(within(dialog).getByLabelText('Detection: never tested here')).toBeTruthy();
    expect(within(dialog).getByText('Never tested here')).toBeTruthy();
  });
});
