/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import type * as Router from '@tanstack/react-router';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithTrpc } from '../../../providers/trpc-test-harness';
import { SelfAssessmentDrawer } from './self-assessment-drawer';

vi.mock('../../../providers/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', effectiveTheme: 'light' }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof Router>(),
  Link: ({ children }: { children: ReactNode }) => <a href="#integrations">{children}</a>,
  useMatches: () => [],
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const capability = (id: string, domain: string, position: number, assessment: object | null = null) => ({
  id,
  externalId: id.toUpperCase(),
  name: `Control ${id}`,
  description: '',
  domain,
  position,
  assessment,
  lastAssessedAt: null,
  lastAssessedBy: null,
  lastAssessedConnector: null,
});

const MANUAL_L1 = { strengthRung: 'L1', coverageBucket: 'L1', strengthMode: 'manual', coverageMode: 'manual', coverageBasis: 'declared', comment: null };
const DERIVED_L2 = { strengthRung: 'L2', coverageBucket: 'L2', strengthMode: 'auto', coverageMode: 'auto', coverageBasis: 'declared', comment: null };

const CATALOGUE = [
  capability('mfa', 'identities', 1, MANUAL_L1),
  capability('pam', 'identities', 2),
  capability('edr', 'endpoints_and_servers', 1, DERIVED_L2),
  capability('waf', 'network', 1),
];

/** Renders the open drawer and returns the inputs `upsertAssessment` was called with. */
const renderDrawer = () => {
  const upserts: Array<unknown> = [];
  renderWithTrpc(<SelfAssessmentDrawer open onClose={() => undefined} />, {
    answers: {
      'controlCapabilities.getControlCapabilities': CATALOGUE,
      'controlCapabilities.upsertAssessment': (input: unknown) => {
        upserts.push(input);
        return undefined;
      },
    },
  });
  return { upserts };
};

const openDomain = async (name: string) => {
  const trigger = await screen.findByRole('button', { name: new RegExp(name) });
  if (trigger.getAttribute('aria-expanded') !== 'true') {
    fireEvent.click(trigger);
  }
};

const row = async (name: string) => {
  const item = (await screen.findByText(name)).closest('li');
  if (item === null) {
    throw new Error(`no row for ${name}`);
  }
  return within(item);
};

describe('SelfAssessmentDrawer', () => {
  it('groups the capabilities by domain in the catalogue order, each with its assessed count', async () => {
    renderDrawer();

    const triggers = (await screen.findAllByRole('button', { name: /assessed$/ })).map((button) => button.textContent);
    expect(triggers).toEqual(['Endpoints and servers1 of 1 assessed', 'Network0 of 1 assessed', 'Identities1 of 2 assessed']);
  });

  it('opens the first domain and keeps the others collapsed', async () => {
    renderDrawer();

    expect(await screen.findByText('Control edr')).toBeTruthy();
    expect(screen.queryByText('Control mfa')).toBeNull();
  });

  it('shows the saved levels of an assessed capability and marks a derived axis as Auto', async () => {
    renderDrawer();

    const edr = await row('Control edr');
    expect(edr.getByRole('button', { name: 'Intermediate' }).getAttribute('aria-pressed')).toBe('true');
    expect(edr.getByRole('button', { name: 'Broad' }).getAttribute('aria-pressed')).toBe('true');
    expect(edr.getAllByText('Auto')).toHaveLength(2);
  });

  it('saves a pick on an assessed capability at once, on that axis alone', async () => {
    const { upserts } = renderDrawer();
    await openDomain('Identities');

    fireEvent.click((await row('Control mfa')).getByRole('button', { name: 'Master' }));

    await vi.waitFor(() => {
      expect(upserts).toEqual([{ capabilityId: 'mfa', strengthRung: 'L3', coverageBucket: null, reattach: [], comment: null }]);
    });
  });

  it('keeps the first pick on an unassessed capability and saves both axes with the second one', async () => {
    const { upserts } = renderDrawer();
    await openDomain('Identities');
    const pam = await row('Control pam');

    fireEvent.click(pam.getByRole('button', { name: 'Not deployed' }));

    expect(upserts).toEqual([]);
    expect(pam.getByText('Answer both questions to assess this control.')).toBeTruthy();

    fireEvent.click(pam.getByRole('button', { name: 'None' }));

    await vi.waitFor(() => {
      expect(upserts).toEqual([{ capabilityId: 'pam', strengthRung: 'L0', coverageBucket: 'L0', reattach: [], comment: null }]);
    });
  });
});
