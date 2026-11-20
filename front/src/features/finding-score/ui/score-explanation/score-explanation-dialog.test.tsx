/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FindingScoreBreakdown } from '../finding-score-section';
import type { ExplanationSubject } from './score-explanation-dialog';
import { ExplanationDialogButton, ScoreInfoButton } from './score-explanation-dialog';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, Link: ({ to, children }: { to: string, children: ReactNode }) => <a href={to}>{children}</a> };
});

const useHasManageSecurity = vi.fn<() => boolean>();
vi.mock('../../../../hooks', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  useHasManageSecurity: () => useHasManageSecurity(),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

beforeEach(() => {
  useHasManageSecurity.mockReturnValue(true);
});

afterEach(() => {
  cleanup();
});

const renderButton = (subject: ExplanationSubject, finding: FindingScoreBreakdown): void => {
  render(<I18nProvider i18n={i18n}><ScoreInfoButton subject={subject} finding={finding} /></I18nProvider>);
};

const T1190 = '0199e2a0-0000-7000-8000-000000000001';
const T1059 = '0199e2a0-0000-7000-8000-000000000002';
const WAF = '0199e2a0-0000-7000-8000-0000000000c1';
const EDR = '0199e2a0-0000-7000-8000-0000000000c2';

const declaredPath = (
  techniqueId: string,
  value: number,
  declaredMu: number,
  claimConfidence: 'high' | 'medium',
  detectMu = 0,
) => ({
  value,
  techniqueId,
  terms: {
    claimConfidence,
    declaredMu,
    cappedResistance: false,
    preventionLetThrough: 1 - declaredMu,
    detectMu,
    detectionCredit: 0.25,
  },
});

const control = (capabilityId: string, name: string) => ({
  capabilityId,
  externalId: name,
  name,
  strengthRung: 'L2' as const,
  coverageBucket: 'L3' as const,
  protectsAssetFamily: true,
  scoredHere: true,
  standsOn: [],
  knockedDownHere: false,
});

/**
 * The worked case of an internet-facing web application carrying Log4Shell, a WAF on its family
 * and an EDR on the estate, with the arithmetic the engine would have produced. The figures are
 * consistent on purpose: the dialogs replay them, so a fixture that does not multiply out would
 * make a passing test prove nothing.
 */
const breakdown = (): FindingScoreBreakdown => ({
  evidenceId: '0199e2a0-0000-7000-8000-00000000000a',
  supportingAssetId: '0199e2a0-0000-7000-8000-00000000000b',
  assetName: 'Card Authorization Engine',
  assetDerivedName: null,
  assetCriticality: 'high',
  assetExposure: 'internet_facing',
  assetCategoryId: 'web_application',
  assetLastSeenAt: null,
  assetOwnerName: null,
  cveId: 'CVE-2021-44228',
  cveTitle: null,
  epss: 0.944,
  knownExploited: true,
  sources: [],
  lastEvaluatedAt: null,
  firstSeenAt: '2026-09-01T00:00:00.000Z',
  currentState: 'applicable',
  currentStateSince: null,
  otherImpactedAssetCount: 0,
  score: 42,
  band: 'medium',
  reachabilityAndThreat: 0.9563333333333333,
  exploitability: 0.3347166666666666,
  impact: 0.54,
  limitingTerm: 'exploitationControls',
  cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H',
  factors: {
    reachability: { value: 0.95, terms: { exposureCountedAs: 'internet_facing', exposureWeight: 0.95, cvssAccess: 1 } },
    threat: {
      value: 0.9626666666666667,
      terms: {
        baseFloor: 0.05,
        signals: [
          { family: 'exploitation_probability', floor: 0.944 },
          { family: 'known_exploited', floor: 0.6 },
          { family: 'active_threat', floor: 0.35 },
        ],
        maxFloor: 0.944,
        familyCount: 3,
        lifted: 0.9626666666666667,
        cvssComplexity: 1,
        damped: 0.9626666666666667,
        heldAtBaseFloor: false,
      },
    },
    exploitationControls: {
      value: 0.35,
      aggregation: 'weakest',
      weakestPath: declaredPath(T1190, 0.35, 0.65, 'high'),
      paths: [declaredPath(T1190, 0.35, 0.65, 'high')],
    },
    potentialImpact: { value: 0.9, terms: { criticalityCountedAs: 'high', criticalityFactor: 0.9, cvssImpact: 1 } },
    impactControls: {
      value: 0.6,
      aggregation: 'mean',
      weakestPath: declaredPath(T1059, 0.6, 0.4, 'high'),
      paths: [declaredPath(T1059, 0.6, 0.4, 'high')],
    },
  },
  composition: { exploitability: 0.3347166666666666, impact: 0.54, product: 0.180747, raw: 42.514350518383786, score: 42 },
  resistance: { exploitation: null, impact: null },
  cvss: {
    access: {
      attackVector: { value: 'N', weight: 0.85 },
      privilegesRequired: { value: 'N', weight: 0.85 },
      userInteraction: { value: 'N', weight: 0.85 },
      product: 0.614125,
      maxProduct: 0.614125,
    },
    impact: {
      confidentiality: { value: 'H', weight: 0.56 },
      integrity: { value: 'H', weight: 0.56 },
      availability: { value: 'H', weight: 0.56 },
      intact: 0.085184,
      damage: 0.914816,
      maxDamage: 0.914816,
      heldAtFloor: false,
    },
  },
  columns: {
    reachability: { exposure: 'internet_facing', categoryId: 'web_application', assetLastSeenAt: null, cvssMetrics: [] },
    threat: {
      exploitationProbability: 0.944,
      knownExploited: true,
      activeThreatCount: 3,
      attackComplexity: 'L',
    },
    potentialImpact: { criticality: 'high', ownerName: null, cvssMetrics: [] },
    validation: null,
    mitigations: [control(WAF, 'Web Application Firewall')],
    uncoveredTechniqueExternalIds: [],
    weakestPath: { externalId: 'T1190', confidence: 'high' },
    techniqueTests: [],
    exploitationTechniques: [{ mitreTechniqueId: T1190, externalId: 'T1190', name: 'Exploit Public-Facing Application', group: 'exploitation', preventingCapabilityIds: [WAF], detectingCapabilityIds: [] }],
    impactControls: {
      mitigations: [control(EDR, 'Endpoint Detection and Response')],
      weakestPath: { externalId: 'T1059', confidence: 'high' },
      techniques: [{ mitreTechniqueId: T1059, externalId: 'T1059', name: 'Command and Scripting Interpreter', group: 'weakness', preventingCapabilityIds: [EDR], detectingCapabilityIds: [] }],
    },
    techniques: null,
  },
});

const onUnclassifiedAsset = (): FindingScoreBreakdown => {
  const finding = breakdown();
  return {
    ...finding,
    assetCriticality: 'unknown',
    factors: {
      ...finding.factors,
      potentialImpact: { value: 0.4, terms: { criticalityCountedAs: 'low', criticalityFactor: 0.4, cvssImpact: 1 } },
    },
    columns: { ...finding.columns, potentialImpact: { ...finding.columns.potentialImpact, criticality: 'unknown' } },
  };
};

const onUnknownExposureAsset = (): FindingScoreBreakdown => {
  const finding = breakdown();
  return {
    ...finding,
    assetExposure: 'unknown',
    factors: {
      ...finding.factors,
      reachability: { value: 0.4, terms: { exposureCountedAs: 'internal', exposureWeight: 0.4, cvssAccess: 1 } },
    },
    columns: { ...finding.columns, reachability: { ...finding.columns.reachability, exposure: 'unknown' } },
  };
};

describe('ScoreInfoButton', () => {
  it('opens nothing until it is pressed', () => {
    renderButton('score', breakdown());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('replays the root the engine produced, truncation included', () => {
    renderButton('score', breakdown());
    fireEvent.click(screen.getByRole('button'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('0.180747');
    expect(dialog.textContent).toContain('42.51');
  });

  it('names both parts the score is drawn from', () => {
    renderButton('score', breakdown());
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog').textContent).toContain('Exploitability, 33, and impact, 54, give 42.');
  });
});

describe('the exploitability explanation', () => {
  it('replays the mean of reachability and threat narrowed by the controls', () => {
    renderButton('exploitability', breakdown());
    fireEvent.click(screen.getByRole('button'));
    const text = screen.getByRole('dialog').textContent;
    expect(text).toContain('0.956');
    expect(text).toContain('0.3347');
    expect(text).toContain('33 / 100');
  });

});

describe('the controls explanations', () => {
  it('lists the exploitation techniques with the controls of the asset family on them', () => {
    renderButton('exploitationControls', breakdown());
    fireEvent.click(screen.getByRole('button', { name: 'How the controls against the exploitation are computed' }));
    const text = screen.getByRole('dialog').textContent;
    expect(text).toContain('controls measured on Web application');
    expect(text).toContain('Exploit Public-Facing Application');
    expect(text).toContain('Web Application Firewall');
  });

  it('lists the impact techniques, the weakness group included, with the controls of the estate', () => {
    renderButton('impactControls', breakdown());
    fireEvent.click(screen.getByRole('button', { name: 'How the controls against the impact are computed' }));
    const text = screen.getByRole('dialog').textContent;
    expect(text).toContain('controls measured on the whole estate');
    expect(text).toContain('Made possible by the weakness');
    expect(text).toContain('Endpoint Detection and Response');
  });

  it('reads an uncovered path of a doubtful claim as letting everything through', () => {
    const finding = breakdown();
    const uncovered = declaredPath(T1190, 1, 0, 'medium');
    renderButton('exploitationControls', {
      ...finding,
      factors: { ...finding.factors, exploitationControls: { value: 1, aggregation: 'weakest', weakestPath: uncovered, paths: [uncovered] } },
    });
    fireEvent.click(screen.getByRole('button'));
    const text = screen.getByRole('dialog').textContent;
    expect(text).toContain('what they hold back, so 100 out of 100 get through');
    expect(text).toContain('No declared control prevents this technique, so prevention holds nothing back here.');
  });

  it('reads the impact side as a mean and names no weakest path there', () => {
    const finding = breakdown();
    const held = declaredPath(T1059, 0.2, 0.8, 'high');
    const open = declaredPath(T1190, 1, 0, 'high');
    renderButton('impactControls', {
      ...finding,
      factors: { ...finding.factors, impactControls: { value: 0.6, aggregation: 'mean', weakestPath: open, paths: [open, held] } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'How the controls against the impact are computed' }));
    const text = screen.getByRole('dialog').textContent;
    expect(text).toContain('2 techniques');
    expect(text).not.toContain('Weakest path');
    expect(text).not.toContain('whatever the confidence of the claim behind it');
  });

  it('narrows what prevention lets through by what a detecting control sees', () => {
    const finding = breakdown();
    const detected = declaredPath(T1190, 0.8, 0, 'high', 0.8);
    renderButton('exploitationControls', {
      ...finding,
      factors: { ...finding.factors, exploitationControls: { value: 0.8, aggregation: 'weakest', weakestPath: detected, paths: [detected] } },
      columns: {
        ...finding.columns,
        mitigations: [control(EDR, 'Endpoint Detection and Response')],
        exploitationTechniques: [{ mitreTechniqueId: T1190, externalId: 'T1190', name: 'Exploit Public-Facing Application', group: 'exploitation', preventingCapabilityIds: [], detectingCapabilityIds: [EDR] }],
      },
    });
    fireEvent.click(screen.getByRole('button'));
    const text = screen.getByRole('dialog').textContent;
    expect(text).toContain('Detected by Endpoint Detection and Response');
    expect(text).toContain('Declared detection');
  });
});

describe('the tile explanations', () => {
  it.each([
    ['reachability', 'How the reachability is computed', '0.95'],
    ['threat', 'How the threat is computed', '0.963'],
    ['potentialImpact', 'How the potential impact is computed', '0.9'],
  ] as const)('opens the %s dialog on its own figure', (subject, triggerLabel, figure) => {
    renderButton(subject, breakdown());
    fireEvent.click(screen.getByRole('button', { name: triggerLabel }));
    expect(screen.getByRole('dialog').textContent).toContain(figure);
  });
});

describe('the reachability explanation', () => {
  it('names the exposure an unknown exposure was counted as and links to where it is set', () => {
    renderButton('reachability', onUnknownExposureAsset());
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog').textContent).toContain('Zone unknown, counted as internal by the CRQ indicators, which also set its weight.');
    expect(screen.getByRole('link', { name: 'CRQ indicators' }).getAttribute('href')).toBe('settings/engine/crq-indicators');
  });

  it('should name the CRQ indicators without a link for a member without the security capability', () => {
    useHasManageSecurity.mockReturnValue(false);
    renderButton('reachability', onUnknownExposureAsset());
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog').textContent).toContain('Zone unknown, counted as internal by the CRQ indicators, which also set its weight.');
    expect(screen.queryByRole('link', { name: 'CRQ indicators' })).toBeNull();
  });

  it('reads a declared exposure as a tenant setting, with no link to the unknown exposure setting', () => {
    renderButton('reachability', breakdown());
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog').textContent).toContain('Zone internet facing. A tenant setting, under CRQ indicators.');
    expect(screen.queryByRole('link', { name: 'CRQ indicators' })).toBeNull();
  });
});

describe('the impact explanation', () => {
  it('replays the potential impact narrowed by the controls', () => {
    renderButton('impact', breakdown());
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog').textContent).toContain('54 / 100');
  });

  it('names the band an unknown criticality was counted as and links to where it is set', () => {
    renderButton('impact', onUnclassifiedAsset());
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog').textContent).toContain('Criticality unknown on the asset, counted as Low by the CRQ indicators, times the vector impact.');
    expect(screen.getByRole('link', { name: 'CRQ indicators' }).getAttribute('href')).toBe('settings/engine/crq-indicators');
  });

  it('drops the vector impact from an unknown criticality when no vector was published', () => {
    const finding = onUnclassifiedAsset();
    renderButton('impact', {
      ...finding,
      factors: {
        ...finding.factors,
        potentialImpact: { value: 0.4, terms: { criticalityCountedAs: 'low', criticalityFactor: 0.4, cvssImpact: null } },
      },
    });
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog').textContent).toContain('Criticality unknown on the asset, counted as Low by the CRQ indicators; no vector was published.');
  });

  it('reads a declared criticality as declared, with no link to the setting', () => {
    renderButton('impact', breakdown());
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog').textContent).toContain('Criticality high, as declared on the asset, times the vector impact.');
    expect(screen.queryByRole('link', { name: 'CRQ indicators' })).toBeNull();
  });
});

describe('ExplanationDialogButton', () => {
  it('keeps every click, on the "i" and in the portalled dialog, from reaching a clickable ancestor', () => {
    const onRowClick = vi.fn();
    render(
      <I18nProvider i18n={i18n}>
        <div onClick={onRowClick}>
          <ExplanationDialogButton triggerLabel="How it is computed" title="Impact if compromised">
            <p>Body</p>
          </ExplanationDialogButton>
        </div>
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'How it is computed' }));
    fireEvent.click(screen.getByText('Body'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);

    expect(onRowClick).not.toHaveBeenCalled();
  });
});
