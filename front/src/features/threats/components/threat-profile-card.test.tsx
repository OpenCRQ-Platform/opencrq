/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ThreatProfileCard } from './threat-profile-card';

type ProfileDetail = ComponentProps<typeof ThreatProfileCard>['detail'];

const STIX_ID = 'campaign--5e2c4a1b-9d3f-4c8e-a6b2-7f1d0e9c3a54';

const detail = (overrides: { entityType: ProfileDetail['analysis']['entityType'], kind: ProfileDetail['origin']['kind'] }): ProfileDetail => ({
  analysis: {
    id: '0190a000-0000-7000-8000-000000000001',
    stixId: STIX_ID,
    entityType: overrides.entityType,
    name: 'Operation Pawn Storm',
    description: null,
    mitreGroupId: null,
    confidence: 70,
    stixCreated: null,
    firstSeen: '2019-02-04T00:00:00Z',
    lastSeen: null,
    primaryMotivation: null,
    resourceLevel: null,
    sophistication: 'expert',
    objective: 'Collect the targets\' diplomatic exchanges',
  },
  origin: { kind: overrides.kind, stixId: STIX_ID, lastIngestedAt: '2026-09-22T00:00:00Z' },
  threatActorTypes: ['nation-state', 'spy'],
  roles: ['sponsor'],
  declaredIntent: {
    primaryMotivations: [{ value: 'organizational-gain' }],
    secondaryMotivations: [],
    goals: [{ value: 'world domination' }],
  },
});

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

describe('ThreatProfileCard', () => {
  it('shows the declared intent as stated values', () => {
    render(<ThreatProfileCard detail={detail({ entityType: 'intrusion-set', kind: 'connector' })} />);

    expect(screen.getByText('Primary motivation')).toBeTruthy();
    expect(screen.getByText('organizational-gain')).toBeTruthy();
    expect(screen.getByText('Goals')).toBeTruthy();
    expect(screen.getByText('world domination')).toBeTruthy();
    expect(screen.queryByText('not in the intent word list')).toBeNull();
  });

  it('says so in one sentence when no source declared a motivation or a goal', () => {
    const base = detail({ entityType: 'intrusion-set', kind: 'connector' });
    render(<ThreatProfileCard detail={{ ...base, declaredIntent: { primaryMotivations: [], secondaryMotivations: [], goals: [] } }} />);

    expect(screen.getByText('No source describing this threat declared a motivation or a goal.')).toBeTruthy();
    expect(screen.queryByText('Primary motivation')).toBeNull();
    expect(screen.queryByText('Goals')).toBeNull();
  });

  it('gives a threat actor its own fields and no campaign objective', () => {
    render(<ThreatProfileCard detail={detail({ entityType: 'threat-actor', kind: 'connector' })} />);

    expect(screen.getByText('Sophistication')).toBeTruthy();
    expect(screen.getByText('expert')).toBeTruthy();
    expect(screen.getByText('Threat actor types')).toBeTruthy();
    expect(screen.getByText('spy')).toBeTruthy();
    expect(screen.getByText('Roles')).toBeTruthy();
    expect(screen.queryByText('Objective')).toBeNull();
  });

  it('gives a campaign its objective and none of the threat actor fields', () => {
    render(<ThreatProfileCard detail={detail({ entityType: 'campaign', kind: 'connector' })} />);

    expect(screen.getByText('Objective')).toBeTruthy();
    expect(screen.getByText('Collect the targets\' diplomatic exchanges')).toBeTruthy();
    expect(screen.queryByText('Sophistication')).toBeNull();
    expect(screen.queryByText('Roles')).toBeNull();
  });

  it('shows the STIX id of a STIX import, as text', () => {
    render(<ThreatProfileCard detail={detail({ entityType: 'campaign', kind: 'stix-import' })} />);

    expect(screen.getByText('STIX import')).toBeTruthy();
    expect(screen.getByText(STIX_ID)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('leaves the STIX id out for a connector threat', () => {
    render(<ThreatProfileCard detail={detail({ entityType: 'intrusion-set', kind: 'connector' })} />);

    expect(screen.getByText('OpenCTI')).toBeTruthy();
    expect(screen.queryByText('STIX ID')).toBeNull();
    expect(screen.getByText('70%')).toBeTruthy();
  });
});
