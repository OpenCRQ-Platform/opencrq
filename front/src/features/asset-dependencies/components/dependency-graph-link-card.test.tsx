/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DependencyGraphEdge, DependencyGraphModel, DependencyGraphNode } from '../dependency-graph-utils';
import { drawnEdges } from '../dependency-graph-utils';
import { DependencyGraphLinkCard } from './dependency-graph-link-card';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ children }: { children: ReactElement }) => children,
    useParams: () => ({}),
  };
});

vi.mock('../hooks/use-primary-asset-scope', () => ({
  usePrimaryAssetScope: () => '00000000-0000-0000-0000-0000000000e1',
}));

vi.mock('../../../providers/tenant-provider', () => ({
  useTenant: () => ({ tenantId: '00000000-0000-0000-0000-00000000000f' }),
}));

vi.mock('../../../providers/theme-provider', () => ({
  useTheme: () => ({ effectiveTheme: 'light' }),
}));

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

const primary: DependencyGraphNode = {
  id: 'primary', label: 'Customer billing', kind: 'primary', level: 0, asset: null, hiddenProviderCount: 0,
};

const assetNode = (id: string, level: number): DependencyGraphNode => ({
  id,
  label: id,
  kind: 'asset',
  level,
  asset: {
    id,
    name: id,
    derivedName: null,
    categoryId: 'host',
    criticality: 'high',
    exposure: 'internal',
    ownerName: null,
    firstSeenAt: null,
    lastSeenAt: null,
    postureScore: null,
    criticalFindingCount: 0,
    highFindingCount: 0,
  },
  hiddenProviderCount: 0,
});

const link = (id: string, source: string, target: string, roles: DependencyGraphEdge['roles'] = null): DependencyGraphEdge => ({
  id, source, target, kind: 'depends_on', roles,
});

const model: DependencyGraphModel = {
  nodes: [primary, assetNode('db-fact-prod', 1), assetNode('esx-cluster-02', 2), assetNode('esx-cluster-03', 2)],
  links: [
    link('l1', 'primary', 'db-fact-prod', ['stores', 'processes']),
    link('l2', 'db-fact-prod', 'esx-cluster-02'),
    link('l3', 'esx-cluster-02', 'esx-cluster-03'),
    link('l4', 'esx-cluster-03', 'esx-cluster-02'),
  ],
  hiddenAssetCount: 0,
};

const renderCard = (edgeId: string) => {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const edge = drawnEdges(model).find((candidate) => candidate.id === edgeId)!;
  render(
    <I18nProvider i18n={i18n}>
      <DependencyGraphLinkCard edge={edge} model={model} onClose={vi.fn()} onEdit={onEdit} onDelete={onDelete} />
    </I18nProvider>,
  );
  return { onEdit, onDelete };
};

/** Where each text starts in the card, which reads top to bottom. */
const positions = (...texts: Array<string>): Array<number> => {
  const read = screen.getByRole('complementary', { name: 'Selected link' }).textContent ?? '';
  return texts.map((text) => read.indexOf(text));
};

describe('DependencyGraphLinkCard', () => {
  it('reads a link to the primary asset as the supporting asset supports the primary asset', () => {
    renderCard('l1');

    const [supporting, verb, supported] = positions('db-fact-prod', 'supports', 'Customer billing');
    expect(supporting).toBeLessThan(verb);
    expect(verb).toBeLessThan(supported);
  });

  it('lists the roles of a link to the primary asset and the criteria they carry', () => {
    renderCard('l1');

    expect(screen.getByText('Stores, Processes')).toBeTruthy();
    expect(screen.getByText('Inherited criteria')).toBeTruthy();
  });

  it('edits and deletes the link to the primary asset', () => {
    const { onEdit, onDelete } = renderCard('l1');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onEdit).toHaveBeenCalledWith(model.links[0]);
    expect(onDelete).toHaveBeenCalledWith(model.links[0]);
  });

  it('reads a link between two supporting assets with its verb, and offers only Delete', () => {
    const { onDelete } = renderCard('l2');

    const [supporting, verb, supported] = positions('esx-cluster-02', 'supports', 'db-fact-prod');
    expect(supporting).toBeLessThan(verb);
    expect(verb).toBeLessThan(supported);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByText('Inherited criteria')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onDelete).toHaveBeenCalledWith(model.links[1]);
  });

  it('reads each link of a mutual dependency as a link of its own, each with its own Delete', () => {
    const { onDelete } = renderCard('l3');

    const card = screen.getByRole('complementary', { name: 'Selected links' });
    expect(card.textContent).toBe('esx-cluster-03Hostsupportsesx-cluster-02HostDeleteesx-cluster-02Hostsupportsesx-cluster-03HostDelete');
    fireEvent.click(screen.getByRole('button', { name: 'Delete the link: esx-cluster-03 supports esx-cluster-02' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete the link: esx-cluster-02 supports esx-cluster-03' }));

    expect(onDelete.mock.calls).toEqual([[model.links[2]], [model.links[3]]]);
  });
});

describe('DependencyGraphLinkCard on an access relation', () => {
  const identity: DependencyGraphNode = {
    ...assetNode('Claire Martin', 0),
    asset: { ...assetNode('Claire Martin', 0).asset!, categoryId: 'identity', criticality: 'very_high' },
  };
  const device: DependencyGraphNode = {
    ...assetNode('PC-FIN-017', 1),
    asset: { ...assetNode('PC-FIN-017', 1).asset!, criticalityLift: { criticality: 'high', fromAssetId: 'Claire Martin' } },
  };
  const relationModel: DependencyGraphModel = {
    nodes: [identity, device],
    links: [{
      id: 'r1',
      source: 'Claire Martin',
      target: 'PC-FIN-017',
      kind: 'primary_user_of',
      roles: null,
      relation: { sources: ['intune_primary_user'], firstSeenAt: '2026-09-02T08:00:00.000Z', lastReportedAt: '2026-10-06T08:00:00.000Z' },
    }],
    hiddenAssetCount: 0,
  };

  const renderRelation = () => render(
    <I18nProvider i18n={i18n}>
      <DependencyGraphLinkCard edge={drawnEdges(relationModel)[0]} model={relationModel} onClose={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />
    </I18nProvider>,
  );

  it('reads from the device to its user, then the band the user gives it, then where and when it was read', () => {
    renderRelation();

    const [laptop, user, given, sentence, source] = positions('PC-FIN-017', 'Claire Martin', 'Criticality given', 'Claire Martin (Very High), which gives High', 'Intune');
    expect(laptop).toBeLessThan(user);
    expect(user).toBeLessThan(given);
    expect(given).toBeLessThan(sentence);
    expect(sentence).toBeLessThan(source);
    expect(screen.getByText('First observation')).toBeTruthy();
    expect(screen.getByText('Last observation')).toBeTruthy();
  });

  it('reads the band given in full to a screen reader, the arrow standing for its source', () => {
    renderRelation();

    expect(screen.getByText('High, given by the assigned user').className).toBe('sr-only');
  });

  it('offers no action, a relation being reconciled by its connector', () => {
    renderRelation();

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});
