/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type * as Router from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CrqPosture } from './crq-posture-tile';
import { CrqPostureTile } from './crq-posture-tile';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof Router>(),
  Link: ({ children }: { children: ReactNode }) => <a href="#finding">{children}</a>,
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

/** The figures multiply out, as the engine produced them: the dialog replays them. */
const WEAK: CrqPosture = {
  score: 32,
  worstFinding: {
    evidenceId: '0199a000-0000-7000-8000-000000000001',
    name: 'CVE-2022-41082',
    exploitability: 68,
    impact: 40,
    score: 52,
  },
  countsByBand: { critical: 0, high: 0, medium: 3, low: 2 },
  composition: {
    tail: [{ band: 'medium', count: 3, pointsPerFinding: 0.005 }, { band: 'low', count: 2, pointsPerFinding: 0.005 }],
    tailPoints: 0.025,
    removedPoints: 68.025,
    capped: false,
    unrounded: 31.975,
  },
};

const CAPPED: CrqPosture = {
  score: 0,
  worstFinding: {
    ...WEAK.worstFinding,
    name: 'CVE-2021-44228',
    exploitability: 100,
    impact: 90,
    score: 94,
  },
  countsByBand: { critical: 1, high: 0, medium: 0, low: 1 },
  composition: {
    tail: [{ band: 'critical', count: 1, pointsPerFinding: 0.07 }, { band: 'low', count: 1, pointsPerFinding: 0.005 }],
    tailPoints: 0.075,
    removedPoints: 100.075,
    capped: true,
    unrounded: 0,
  },
};

const openDialog = (posture: CrqPosture): HTMLElement => {
  render(<I18nProvider i18n={i18n}><CrqPostureTile tenantId="t" posture={posture} /></I18nProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'How the OpenCRQ Posture is computed' }));
  return screen.getByRole('dialog');
};

describe('CrqPostureTile', () => {
  it('states the score and its band out loud, and names no finding on the tile', () => {
    render(<CrqPostureTile tenantId="t" posture={WEAK} />);
    expect(screen.getByLabelText('OpenCRQ Posture score: 32 out of 100, weak')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('reads an asset with nothing scored as nothing to measure, not as a failure', () => {
    const { container } = render(<CrqPostureTile tenantId="t" posture={null} />);
    expect(container.querySelector('[title="OpenCRQ Posture: no applicable finding to measure"]')).not.toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('marks the tile busy while the posture loads', () => {
    const { container } = render(<CrqPostureTile tenantId="t" posture={undefined} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('the OpenCRQ Posture explanation', () => {
  it('links the worst finding and sets its score beside the exploitability the posture reads', () => {
    const dialog = openDialog(WEAK);
    expect(screen.getByRole('link').textContent).toBe('CVE-2022-41082');
    expect(dialog.textContent).toContain('Exploitability 68');
    expect(dialog.textContent).toContain('Finding score 52');
  });

  it('says the impact is what separates the two figures', () => {
    expect(openDialog(WEAK).textContent).toContain('The finding score sets it against the impact, 40,');
  });

  it('counts every applicable finding by band on one line', () => {
    const text = openDialog(WEAK).textContent;
    expect(text).toContain('5 applicable');
    expect(text).toContain('3 medium');
    expect(text).toContain('2 low');
  });

  it('replays the arithmetic without a ceiling line when the ceiling did not bite', () => {
    const text = openDialog(WEAK).textContent;
    expect(text).toContain('= 68 + 0.025 = 68.025');
    expect(text).toContain('= 100 − 68.025 = 31.975');
    expect(text).not.toContain('capped');
  });

  it('shows the ceiling when the worst finding alone reaches it', () => {
    const text = openDialog(CAPPED).textContent;
    expect(text).toContain('= 100 + 0.075 = 100.075');
    expect(text).toContain('capped');
    expect(text).toContain('which alone takes the whole posture');
  });
});
