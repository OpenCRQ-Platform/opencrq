/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { StreamRelationship, StreamVerdict } from '../opencti-stream-filter-utils';
import { OpenctiStreamVerdictNotice } from './opencti-stream-verdict';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderNotice = (verdict: StreamVerdict, missing: Array<StreamRelationship> = []) =>
  render(
    <I18nProvider i18n={i18n}>
      <OpenctiStreamVerdictNotice verdict={verdict} missingRelationships={missing} />
    </I18nProvider>,
  );

describe('OpenctiStreamVerdictNotice', () => {
  it('names the relationship a rejected filter leaves out, since the operator has to add it', () => {
    renderNotice('incompatible', ['intrusion_set_targets_vulnerability']);

    expect(screen.getByText(/"targets" from an intrusion set to a vulnerability/)).toBeTruthy();
  });

  it('names only what is missing, never the legs the filter does admit', () => {
    renderNotice('incompatible', ['intrusion_set_targets_vulnerability']);

    expect(screen.getByText(/no CVE targeted by an intrusion set/)).toBeTruthy();
    expect(screen.queryByText(/no technique/)).toBeNull();
    expect(screen.queryByText(/no sector/)).toBeNull();
    expect(screen.queryByText(/no country/)).toBeNull();
  });

  it('lists every missing relationship when the filter leaves out several', () => {
    renderNotice('incompatible', ['intrusion_set_uses_technique', 'intrusion_set_targets_sector']);

    expect(screen.getByText(/"uses" from an intrusion set to an attack pattern/)).toBeTruthy();
    expect(screen.getByText(/"targets" from an intrusion set to a sector/)).toBeTruthy();
  });

  it('names the actor a missing relationship leaves from, since intrusion sets may still arrive whole', () => {
    renderNotice('incompatible', ['campaign_uses_technique']);

    expect(screen.getByText(/"uses" from a campaign to an attack pattern/)).toBeTruthy();
    expect(screen.getByText(/no technique of a campaign/)).toBeTruthy();
  });

  it('names a missing attribution between threats', () => {
    renderNotice('incompatible', ['attributed_to']);

    expect(screen.getByText(/"attributed-to" between threats/)).toBeTruthy();
  });

  it('does not claim the stream carries no threat actor, which is a different fault', () => {
    renderNotice('incompatible', ['intrusion_set_uses_technique']);

    expect(screen.queryByText(/admits no threat actor/)).toBeNull();
  });
});
