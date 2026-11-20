/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../providers/trpc-test-harness';
import { TtpMatrixView } from './ttp-matrix-view';

const MATRIX = {
  tactics: [
    { id: 'tactic-initial-access', name: 'Initial Access', externalId: 'TA0001', order: 1 },
    { id: 'tactic-execution', name: 'Execution', externalId: 'TA0002', order: 2 },
    { id: 'tactic-credential-access', name: 'Credential Access', externalId: 'TA0006', order: 3 },
  ],
  techniques: [
    { id: 't1078', externalId: 'T1078', name: 'Valid Accounts', isSubtechnique: false, parentTechniqueId: null },
    { id: 't1059', externalId: 'T1059', name: 'Command and Scripting Interpreter', isSubtechnique: false, parentTechniqueId: null },
    { id: 't1110', externalId: 'T1110', name: 'Brute Force', isSubtechnique: false, parentTechniqueId: null },
  ],
  junctions: [
    { tacticId: 'tactic-initial-access', techniqueId: 't1078' },
    { tacticId: 'tactic-execution', techniqueId: 't1059' },
    { tacticId: 'tactic-credential-access', techniqueId: 't1110' },
  ],
};

vi.mock('../../hooks', () => ({
  useDragToScroll: () => ({ containerRef: { current: null }, onPointerDown: vi.fn(), onPointerMove: vi.fn(), onPointerUp: vi.fn() }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderMatrix = (tacticIds?: ReadonlyArray<string>): void => {
  renderWithTrpc(<TtpMatrixView highlightedTechniques={[]} tacticIds={tacticIds} />, {
    answers: { 'mitreAttack.getMatrix': MATRIX },
  });
};

describe('TtpMatrixView', () => {
  it('should show every tactic column when no tactic is given', async () => {
    renderMatrix();

    expect(await screen.findByText('Initial Access')).toBeTruthy();
    expect(screen.getByText('Execution')).toBeTruthy();
    expect(screen.getByText('Credential Access')).toBeTruthy();
    expect(screen.getByText('Brute Force')).toBeTruthy();
  });

  it('should keep only the columns of the given tactics', async () => {
    renderMatrix(['tactic-credential-access']);

    expect(await screen.findByText('Credential Access')).toBeTruthy();
    expect(screen.getByText('Brute Force')).toBeTruthy();
    expect(screen.queryByText('Initial Access')).toBeNull();
    expect(screen.queryByText('Execution')).toBeNull();
    expect(screen.queryByText('Valid Accounts')).toBeNull();
  });
});
