/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { OpenctiStream } from '../opencti-stream-filter-utils';
import { OpenctiStreamOption } from './opencti-stream-option';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const stream = (partial: Partial<OpenctiStream>): OpenctiStream => ({
  id: 'stream-1',
  name: 'Threat actors',
  description: null,
  rawFilter: '{}',
  filterGroup: {
    mode: 'and',
    filters: [{ key: ['entity_type'], operator: 'eq', mode: 'or', values: ['Intrusion-Set'] }],
    filterGroups: [],
  },
  verdict: 'delivers',
  missingRelationships: [],
  replaysHistory: true,
  ...partial,
});

/** As the combobox mounts it: the row is the whole content of the listbox option. */
const renderOption = (option: OpenctiStream) =>
  render(
    <I18nProvider i18n={i18n}>
      <ul role="listbox" aria-label="Live Streams">
        <li role="option" aria-selected={false}>
          <OpenctiStreamOption stream={option} />
        </li>
      </ul>
    </I18nProvider>,
  );

describe('OpenctiStreamOption', () => {
  it('carries the filter précis in the option itself, reachable without a pointer', () => {
    renderOption(stream({}));

    expect(screen.getByRole('option', { name: /Admits Intrusion-Set, and nothing else\./ })).toBeTruthy();
  });

  it('names the verdict beside it, so two streams can be told apart before either is selected', () => {
    renderOption(stream({ verdict: 'no_actors' }));

    expect(screen.getByRole('option', { name: /No threat actors/ })).toBeTruthy();
  });

  it('tells a filter carrying no relationship apart from one carrying no actor', () => {
    renderOption(stream({ verdict: 'incompatible' }));

    expect(screen.getByRole('option', { name: /Incompatible filter/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /No threat actors/ })).toBeNull();
  });

  it('states what it could not read rather than leaving the row bare', () => {
    renderOption(stream({ rawFilter: 'not json', filterGroup: null, verdict: 'undecidable' }));

    expect(screen.getByRole('option', { name: /This filter could not be read\./ })).toBeTruthy();
  });
});
