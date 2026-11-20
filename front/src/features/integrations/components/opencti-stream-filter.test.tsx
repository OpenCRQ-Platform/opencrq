/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { StreamFilterGroup } from '../opencti-stream-filter-utils';
import { streamFilterPrecis } from '../opencti-stream-filter-utils';
import { OpenctiStreamFilter, OpenctiStreamFilterPrecis } from './opencti-stream-filter';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const renderTranslated = (element: ReactElement) =>
  render(<I18nProvider i18n={i18n}>{element}</I18nProvider>);

const THREAT_RAW = '{"mode":"and","filters":[{"key":["entity_type"],"operator":"eq","values":["Intrusion-Set"],"mode":"or"}],"filterGroups":[]}';

const threatGroup: StreamFilterGroup = {
  mode: 'and',
  filters: [{ key: ['entity_type'], operator: 'eq', mode: 'or', values: ['Intrusion-Set'] }],
  filterGroups: [],
};

describe('OpenctiStreamFilter', () => {
  it('renders a clause with the reader-facing key and operator, and the value as it stands', () => {
    renderTranslated(<OpenctiStreamFilter filterGroup={threatGroup} rawFilter={THREAT_RAW} />);

    expect(screen.getByText('Entity type')).toBeTruthy();
    expect(screen.getByText('is one of')).toBeTruthy();
    expect(screen.getByText('Intrusion-Set')).toBeTruthy();
  });

  it('shows the stream filter as OpenCTI stores it when the raw view is asked for', () => {
    const { container } = renderTranslated(<OpenctiStreamFilter filterGroup={threatGroup} rawFilter={THREAT_RAW} />);

    // Radix switches the panel on mousedown, not on click.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Raw' }), { button: 0 });

    expect(container.querySelector('pre')?.textContent).toContain('"entity_type"');
  });

  it('names the alternatives of a group of relationship branches', () => {
    const group: StreamFilterGroup = {
      mode: 'or',
      filters: [{ key: ['entity_type'], operator: 'eq', mode: 'or', values: ['Intrusion-Set'] }],
      filterGroups: [{
        mode: 'and',
        filters: [
          { key: ['entity_type'], operator: 'eq', mode: 'or', values: ['targets'] },
          { key: ['fromTypes'], operator: 'eq', mode: 'or', values: ['Intrusion-Set'] },
        ],
        filterGroups: [],
      }],
    };
    renderTranslated(<OpenctiStreamFilter filterGroup={group} rawFilter="{}" />);

    expect(screen.getByText('Any of')).toBeTruthy();
    expect(screen.getByText('All of')).toBeTruthy();
    expect(screen.getByText('From type')).toBeTruthy();
  });

  it('says a stream carries no filter rather than showing an empty one', () => {
    renderTranslated(<OpenctiStreamFilter filterGroup={null} rawFilter={null} />);

    expect(screen.getByText(/carries no filter/)).toBeTruthy();
  });

  it('shows a filter it could not read as OpenCTI stores it, and says so', () => {
    renderTranslated(<OpenctiStreamFilter filterGroup={null} rawFilter="not json" />);

    expect(screen.getByText(/could not be read/)).toBeTruthy();
    expect(screen.getByText('not json')).toBeTruthy();
  });
});

describe('OpenctiStreamFilterPrecis', () => {
  it('names the types the filter admits and says they are the whole of it', () => {
    renderTranslated(<OpenctiStreamFilterPrecis precis={streamFilterPrecis(threatGroup, THREAT_RAW, 'delivers')} />);

    expect(screen.getByText('Admits Intrusion-Set, and nothing else.')).toBeTruthy();
  });

  it('stops claiming the types are the whole filter once another condition joins them', () => {
    const group: StreamFilterGroup = {
      mode: 'and',
      filters: [
        { key: ['entity_type'], operator: 'eq', mode: 'or', values: ['Intrusion-Set'] },
        { key: ['createdBy'], operator: 'eq', mode: 'or', values: ['06914efb'] },
      ],
      filterGroups: [],
    };
    renderTranslated(<OpenctiStreamFilterPrecis precis={streamFilterPrecis(group, '{}', 'delivers')} />);

    expect(screen.getByText('Admits Intrusion-Set, with further conditions.')).toBeTruthy();
  });

  it('says an `and` of two type clauses admits nothing rather than naming both types', () => {
    const group: StreamFilterGroup = {
      mode: 'and',
      filters: [
        { key: ['entity_type'], operator: 'eq', mode: 'or', values: ['Intrusion-Set'] },
        { key: ['entity_type'], operator: 'eq', mode: 'or', values: ['Indicator'] },
      ],
      filterGroups: [],
    };
    renderTranslated(<OpenctiStreamFilterPrecis precis={streamFilterPrecis(group, '{}', 'delivers')} />);

    expect(screen.getByText('Admits nothing: its conditions on entity type cannot hold together.')).toBeTruthy();
  });

  it('falls back to the conditions for a filter that names no type', () => {
    const group: StreamFilterGroup = {
      mode: 'and',
      filters: [{ key: ['objectMarking'], operator: 'eq', mode: 'or', values: ['TLP:CLEAR'] }],
      filterGroups: [],
    };
    renderTranslated(<OpenctiStreamFilterPrecis precis={streamFilterPrecis(group, '{}', 'delivers')} />);

    expect(screen.getByText('Selects by Marking, and names no type.')).toBeTruthy();
  });
});
