import { describe, expect, it } from 'vitest';
import type { TopRisksFlow, TopRisksScenarioInput } from './top-risks-flow-utils';
import {
  ASSET_TAIL_ID,
  buildTopRisksFlow,
  describeTopRisksNode,
  layoutTopRisks,
  NO_PRIMARY_ASSET_ID,
  outcomeColor,
  SCENARIO_TAIL_ID,
  spreadLabelCenters,
  TOP_RISKS_BASE_GEOMETRY,
  TOP_RISKS_COLUMNS,
  topRisksGeometryForWidth,
  UNALLOCATED_CATEGORY_ID,
} from './top-risks-flow-utils';

const scenario = (overrides: Partial<TopRisksScenarioInput> = {}): TopRisksScenarioInput => ({
  scenarioId: 's1',
  name: 'Ransomware on the core banking system',
  organizationId: 'org-1',
  outcomeId: 'o-rans',
  outcomeName: 'Ransomware',
  ale: 1000,
  aleP10: 200,
  aleP90: 3000,
  lefMean: 0.2,
  primaryAssets: [{ id: 'pa-core', name: 'Core banking' }],
  categoryExpectations: [
    { categoryId: 'c-bi', categoryName: 'Business Interruption', expected: 300 },
    { categoryId: 'c-ri', categoryName: 'Response & Investigation', expected: 100 },
  ],
  ...overrides,
});

const node = (flow: TopRisksFlow, id: string) => {
  const found = flow.nodes.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`no node ${id}`);
  }
  return found;
};

const columnTotal = (flow: TopRisksFlow, column: string): number =>
  flow.nodes.filter((candidate) => candidate.column === column).reduce((sum, candidate) => sum + candidate.value, 0);

const assets = (count: number) => Array.from({ length: count }, (_, index) => scenario({
  scenarioId: `s${index}`,
  name: `Scenario ${index}`,
  ale: 100 * (count - index),
  primaryAssets: [{ id: `pa${index}`, name: `Asset ${index}` }],
}));

describe('buildTopRisksFlow', () => {
  it('should split the same total in every column', () => {
    const flow = buildTopRisksFlow([
      scenario(),
      scenario({ scenarioId: 's2', outcomeId: 'o-dte', outcomeName: 'Data Theft Extortion', ale: 500, primaryAssets: [{ id: 'pa-core', name: 'Core banking' }, { id: 'pa-cust', name: 'Customer data' }] }),
      scenario({ scenarioId: 's3', ale: 250, primaryAssets: [], categoryExpectations: [] }),
    ]);

    expect(flow.total).toBe(1750);
    for (const column of TOP_RISKS_COLUMNS) {
      expect(columnTotal(flow, column)).toBeCloseTo(1750, 9);
    }
  });

  it('should send half the loss of a scenario with two primary assets to each', () => {
    const flow = buildTopRisksFlow([scenario({ primaryAssets: [{ id: 'pa-a', name: 'A' }, { id: 'pa-b', name: 'B' }] })]);

    expect(node(flow, 'asset:pa-a').value).toBe(500);
    expect(node(flow, 'asset:pa-b').value).toBe(500);
  });

  it('should flow a scenario with no primary asset from the no primary asset node', () => {
    const flow = buildTopRisksFlow([scenario({ primaryAssets: [] })]);

    expect(node(flow, NO_PRIMARY_ASSET_ID)).toMatchObject({ value: 1000, residualKind: 'no-primary-asset', entityId: null });
  });

  it('should split a scenario across loss categories in proportion to its loss estimates', () => {
    const flow = buildTopRisksFlow([scenario({
      categoryExpectations: [
        { categoryId: 'c-bi', categoryName: 'Business Interruption', expected: 200 },
        { categoryId: 'c-ri', categoryName: 'Response & Investigation', expected: 100 },
        { categoryId: 'c-bi', categoryName: 'Business Interruption', expected: 100 },
      ],
    })]);

    expect(node(flow, 'category:c-bi')).toMatchObject({ value: 750, label: 'Business Interruption' });
    expect(node(flow, 'category:c-ri').value).toBe(250);
  });

  it('should send a scenario without loss estimates to the unallocated category', () => {
    const flow = buildTopRisksFlow([scenario({ categoryExpectations: [] })]);

    expect(node(flow, UNALLOCATED_CATEGORY_ID)).toMatchObject({ value: 1000, residualKind: 'unallocated-category' });
  });

  it('should fold eight primary assets into six and one node for the other two', () => {
    const flow = buildTopRisksFlow(assets(8));

    const column = flow.nodes.filter((candidate) => candidate.column === 'asset');
    expect(column).toHaveLength(7);
    expect(node(flow, ASSET_TAIL_ID)).toMatchObject({ foldedCount: 2, value: 200 + 100, residualKind: 'asset-tail' });
    expect(column.map((candidate) => candidate.id)).not.toContain('asset:pa7');
  });

  it('should show all of seven primary assets rather than fold a single one', () => {
    const flow = buildTopRisksFlow(assets(7));

    expect(flow.nodes.filter((candidate) => candidate.column === 'asset')).toHaveLength(7);
    expect(flow.nodes.some((candidate) => candidate.id === ASSET_TAIL_ID)).toBe(false);
  });

  it('should fold the scenario column past six on the same rule', () => {
    const flow = buildTopRisksFlow(assets(9));

    expect(node(flow, SCENARIO_TAIL_ID)).toMatchObject({ foldedCount: 3, residualKind: 'scenario-tail' });
  });

  it('should never fold the no primary asset node into the other primary assets', () => {
    const flow = buildTopRisksFlow([...assets(7), scenario({ scenarioId: 'orphan', ale: 1, primaryAssets: [] })]);

    expect(node(flow, NO_PRIMARY_ASSET_ID).value).toBe(1);
    expect(flow.nodes.some((candidate) => candidate.id === ASSET_TAIL_ID)).toBe(false);
  });

  it('should leave out a scenario whose run is not priced', () => {
    const flow = buildTopRisksFlow([scenario(), scenario({ scenarioId: 's2', ale: 0 })]);

    expect(flow.total).toBe(1000);
    expect(flow.nodes.some((candidate) => candidate.id === 'scenario:s2')).toBe(false);
  });
});

describe('describeTopRisksNode', () => {
  const flow = buildTopRisksFlow([
    scenario({ primaryAssets: [{ id: 'pa-core', name: 'Core banking' }, { id: 'pa-pay', name: 'Payments' }] }),
    scenario({ scenarioId: 's2', name: 'Wire fraud', outcomeId: 'o-ff', outcomeName: 'Financial Fraud & Funds Theft', ale: 400, primaryAssets: [{ id: 'pa-pay', name: 'Payments' }] }),
  ]);

  it('should give a scenario its outcome, primary assets, band and LEF', () => {
    expect(describeTopRisksNode(flow, node(flow, 'scenario:s1'))).toEqual({
      kind: 'scenario',
      outcomeName: 'Ransomware',
      primaryAssetNames: ['Core banking', 'Payments'],
      aleP10: 200,
      aleP90: 3000,
      lefMean: 0.2,
    });
  });

  it('should give a primary asset its scenario count and the part it holds through an equal split', () => {
    expect(describeTopRisksNode(flow, node(flow, 'asset:pa-pay'))).toEqual({ kind: 'asset', scenarioCount: 2, sharedValue: 500 });
  });

  it('should give an outcome its main loss category and a category its main outcome', () => {
    expect(describeTopRisksNode(flow, node(flow, 'outcome:o-rans'))).toMatchObject({
      kind: 'outcome',
      scenarioCount: 1,
      mainCategory: { node: { id: 'category:c-bi' }, share: 0.75 },
    });
    expect(describeTopRisksNode(flow, node(flow, 'category:c-ri'))).toMatchObject({
      kind: 'category',
      mainOutcome: { node: { id: 'outcome:o-rans' }, share: 250 / 350 },
    });
  });
});

describe('layoutTopRisks', () => {
  const flow = buildTopRisksFlow([
    scenario(),
    scenario({ scenarioId: 's2', outcomeId: 'o-dte', outcomeName: 'Data Theft Extortion', ale: 500, primaryAssets: [{ id: 'pa-cust', name: 'Customer data' }] }),
  ]);

  it('should colour every ribbon by the outcome of the loss it carries', () => {
    const layout = layoutTopRisks(flow, TOP_RISKS_BASE_GEOMETRY, null);

    const assetToScenario = layout.ribbons.filter((ribbon) => ribbon.key.includes('scenario:s2'));
    expect(assetToScenario.length).toBeGreaterThan(0);
    expect(assetToScenario.every((ribbon) => ribbon.outcome === 'outcome:o-dte')).toBe(true);
  });

  it('should give a label two lines only when its neighbours leave the room', () => {
    const crowded = buildTopRisksFlow([...assets(6), scenario({ scenarioId: 'big', ale: 1e6, primaryAssets: [{ id: 'pa-big', name: 'Big' }] })]);
    const layout = layoutTopRisks(crowded, TOP_RISKS_BASE_GEOMETRY, null);

    expect(layout.nodes.find((positioned) => positioned.id === 'asset:pa-big')?.labelLines).toBe(2);
    expect(layout.nodes.find((positioned) => positioned.id === 'asset:pa3')?.labelLines).toBe(1);
  });

  it('should stack each column inside the drawing height', () => {
    const layout = layoutTopRisks(flow, TOP_RISKS_BASE_GEOMETRY, null);

    for (const positioned of layout.nodes) {
      expect(positioned.y).toBeGreaterThanOrEqual(0);
      expect(positioned.y + positioned.height).toBeLessThanOrEqual(TOP_RISKS_BASE_GEOMETRY.height + 1e-9);
    }
  });

  it('should light only the flows through the focused node', () => {
    const layout = layoutTopRisks(flow, TOP_RISKS_BASE_GEOMETRY, 'asset:pa-cust');

    expect([...layout.lit ?? []].toSorted()).toEqual(['asset:pa-cust', 'category:c-bi', 'category:c-ri', 'outcome:o-dte', 'scenario:s2']);
    expect(layout.ribbons.filter((ribbon) => ribbon.focusPath !== null).every((ribbon) => ribbon.outcome === 'outcome:o-dte')).toBe(true);
  });

  it('should light nothing with no focus', () => {
    const layout = layoutTopRisks(flow, TOP_RISKS_BASE_GEOMETRY, null);

    expect(layout.lit).toBeNull();
    expect(layout.ribbons.every((ribbon) => ribbon.focusPath === null)).toBe(true);
  });
});

describe('spreadLabelCenters', () => {
  it('should leave labels that already have a line each where they are', () => {
    expect(spreadLabelCenters([20, 100, 300], 440)).toEqual([20, 100, 300]);
  });

  it('should push crowded labels a line apart, upwards from the bottom edge', () => {
    expect(spreadLabelCenters([430, 434, 436], 440)).toEqual([405, 419, 433]);
  });

  it('should keep the first label inside the top edge', () => {
    expect(spreadLabelCenters([0, 2], 440)).toEqual([7, 21]);
  });
});

describe('topRisksGeometryForWidth', () => {
  it('should keep the base geometry below its width and stretch the columns above it', () => {
    expect(topRisksGeometryForWidth(600)).toBe(TOP_RISKS_BASE_GEOMETRY);
    const wide = topRisksGeometryForWidth(1792);
    expect(wide.width).toBe(1792);
    expect(wide.columnX).toEqual(TOP_RISKS_BASE_GEOMETRY.columnX.map((x) => x * 2));
    expect(wide.bar).toBe(TOP_RISKS_BASE_GEOMETRY.bar);
  });
});

describe('outcomeColor', () => {
  it('should colour the catalogue outcomes and fall back for any other name', () => {
    expect(outcomeColor('Ransomware')).toBe('#d95926');
    expect(outcomeColor('Espionage')).toBe('#d55181');
    expect(outcomeColor('Something else')).toBe('#7f8794');
  });
});
