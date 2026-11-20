/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ThreatAnalysisDetailData } from './threat-detail-tabs';
import type { ThreatTechniqueRow } from './threat-ttp-utils';

vi.mock('./threat-techniques-view', () => ({
  ThreatTechniquesView: ({ techniques }: { techniques: Array<ThreatTechniqueRow> }) => (
    <div data-testid="techniques-view">{techniques.map((technique) => technique.externalId).join(',')}</div>
  ),
}));

const { ThreatTtpsTab } = await import('./threat-detail-tabs');

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const STIX_ID = 'intrusion-set--11111111-1111-1111-1111-111111111111';

const technique = (mitreExternalId: string, mitreTechniqueId: string | null): ThreatAnalysisDetailData['techniques'][number] => ({
  id: `claim-${mitreExternalId}`,
  stixId: `attack-pattern--${mitreExternalId}`,
  name: mitreExternalId,
  mitreExternalId,
  citedExternalIds: [mitreExternalId],
  mitreTechniqueId,
  mitreTechniqueUrl: null,
  tactics: [],
  openctiStixRelationId: null,
});

const DETAIL: ThreatAnalysisDetailData = {
  analysis: {
    id: '0190a000-0000-7000-8000-000000000001',
    stixId: STIX_ID,
    entityType: 'intrusion-set',
    name: 'APT28',
    description: null,
    mitreGroupId: 'G0007',
    confidence: 85,
    stixCreated: null,
    firstSeen: null,
    lastSeen: null,
    primaryMotivation: null,
    resourceLevel: null,
    sophistication: null,
    objective: null,
  },
  attributedTo: [],
  attributedFrom: [],
  threatActorTypes: [],
  roles: [],
  origin: { kind: 'stix-import', stixId: STIX_ID, lastIngestedAt: '2026-01-01T00:00:00Z' },
  activity: { activityScore: 0, lastObservedAt: null, lastObservedVia: null },
  locations: [],
  sectors: [],
  cves: [],
  techniques: [technique('T1078', 't1078'), technique('T9999', null)],
  declaredIntent: { primaryMotivations: [], secondaryMotivations: [], goals: [] },
};

const renderTab = (): void => {
  render(
    <I18nProvider i18n={i18n}>
      <ThreatTtpsTab detail={DETAIL} />
    </I18nProvider>,
  );
};

describe('ThreatTtpsTab', () => {
  it('should render the view on the techniques matched to the catalogue', () => {
    renderTab();

    expect(screen.getByTestId('techniques-view').textContent).toBe('T1078');
  });
});
