/**
 * The engine prices a scenario as a whole. Both the asset split (equal parts over the scenario's
 * primary assets) and the category split (in proportion to the PERT expectation of its loss
 * estimates) are attributions, so every column adds up to the same total by construction.
 */
import { tailIds, toShares } from './exposure-flow-utils';

export const TOP_RISKS_COLUMNS = ['asset', 'scenario', 'outcome', 'category'] as const;
export type TopRisksColumn = typeof TOP_RISKS_COLUMNS[number];

/** The view labels these, since their text is translated and pluralised. */
export type TopRisksResidualKind = 'no-primary-asset' | 'asset-tail' | 'scenario-tail' | 'unallocated-category';

export const NO_PRIMARY_ASSET_ID = 'asset:none';
export const ASSET_TAIL_ID = 'asset:tail';
export const SCENARIO_TAIL_ID = 'scenario:tail';
export const UNALLOCATED_CATEGORY_ID = 'category:unallocated';

const ASSET_PREFIX = 'asset:';
const SCENARIO_PREFIX = 'scenario:';
const OUTCOME_PREFIX = 'outcome:';
const CATEGORY_PREFIX = 'category:';

export const TOP_RISKS_KEEP = 6;

export interface TopRisksScenarioInput {
  scenarioId: string,
  name: string,
  organizationId: string,
  outcomeId: string,
  outcomeName: string,
  ale: number,
  aleP10: number | null,
  aleP90: number | null,
  lefMean: number | null,
  primaryAssets: Array<{ id: string, name: string }>,
  /** One entry per loss estimate; several estimates of one category add up. */
  categoryExpectations: Array<{ categoryId: string, categoryName: string, expected: number }>,
}

export interface TopRisksNode {
  id: string,
  column: TopRisksColumn,
  label: string,
  value: number,
  residualKind: TopRisksResidualKind | null,
  foldedCount: number,
  entityId: string | null,
}

/** One scenario's loss through one primary asset into one loss category, after the folds. */
export interface TopRisksItem {
  asset: string,
  scenario: string,
  outcome: string,
  category: string,
  scenarioId: string,
  sharedAsset: boolean,
  value: number,
}

export interface TopRisksFlow {
  nodes: Array<TopRisksNode>,
  items: Array<TopRisksItem>,
  total: number,
  scenarios: Map<string, TopRisksScenarioInput>,
}

const addTo = (map: Map<string, number>, key: string, value: number): void => {
  map.set(key, (map.get(key) ?? 0) + value);
};

/** Folds only when at least two nodes would go, so a tail never stands for a single entity. */
const foldedIds = (values: Map<string, number>, pinned: Array<string>): Set<string> => {
  const candidates = [...values.keys()].filter((id) => !pinned.includes(id)).length;
  return candidates > TOP_RISKS_KEEP + 1 ? tailIds(values, TOP_RISKS_KEEP, pinned) : new Set();
};

export const buildTopRisksFlow = (scenarios: Array<TopRisksScenarioInput>): TopRisksFlow => {
  const raw: Array<TopRisksItem> = [];
  const names = new Map<string, string>();
  const priced = new Map<string, TopRisksScenarioInput>();
  let total = 0;

  for (const scenario of scenarios) {
    if (!(scenario.ale > 0)) {
      continue;
    }
    priced.set(scenario.scenarioId, scenario);
    total += scenario.ale;
    const scenarioId = `${SCENARIO_PREFIX}${scenario.scenarioId}`;
    const outcomeId = `${OUTCOME_PREFIX}${scenario.outcomeId}`;
    names.set(scenarioId, scenario.name);
    names.set(outcomeId, scenario.outcomeName);

    const assetIds = scenario.primaryAssets.length > 0
      ? scenario.primaryAssets.map((asset) => {
        const id = `${ASSET_PREFIX}${asset.id}`;
        names.set(id, asset.name);
        return id;
      })
      : [NO_PRIMARY_ASSET_ID];

    for (const expectation of scenario.categoryExpectations) {
      names.set(`${CATEGORY_PREFIX}${expectation.categoryId}`, expectation.categoryName);
    }
    const shares = toShares(
      scenario.categoryExpectations,
      (expectation) => `${CATEGORY_PREFIX}${expectation.categoryId}`,
      (expectation) => expectation.expected,
    );
    const categoryShares = shares.size > 0 ? shares : new Map([[UNALLOCATED_CATEGORY_ID, 1]]);

    for (const asset of assetIds) {
      for (const [category, share] of categoryShares) {
        raw.push({
          asset,
          scenario: scenarioId,
          outcome: outcomeId,
          category,
          scenarioId: scenario.scenarioId,
          sharedAsset: assetIds.length > 1,
          value: (scenario.ale / assetIds.length) * share,
        });
      }
    }
  }

  const assetValues = new Map<string, number>();
  const scenarioValues = new Map<string, number>();
  for (const item of raw) {
    addTo(assetValues, item.asset, item.value);
    addTo(scenarioValues, item.scenario, item.value);
  }
  const foldedAssets = foldedIds(assetValues, [NO_PRIMARY_ASSET_ID]);
  const foldedScenarios = foldedIds(scenarioValues, []);

  const items = raw.map((item) => ({
    ...item,
    asset: foldedAssets.has(item.asset) ? ASSET_TAIL_ID : item.asset,
    scenario: foldedScenarios.has(item.scenario) ? SCENARIO_TAIL_ID : item.scenario,
  }));

  const values = new Map<string, number>();
  const columnOf = new Map<string, TopRisksColumn>();
  for (const item of items) {
    for (const column of TOP_RISKS_COLUMNS) {
      addTo(values, item[column], item.value);
      columnOf.set(item[column], column);
    }
  }

  const residualKind = (id: string): TopRisksResidualKind | null => {
    switch (id) {
      case NO_PRIMARY_ASSET_ID: return 'no-primary-asset';
      case ASSET_TAIL_ID: return 'asset-tail';
      case SCENARIO_TAIL_ID: return 'scenario-tail';
      case UNALLOCATED_CATEGORY_ID: return 'unallocated-category';
      default: return null;
    }
  };

  const nodes: Array<TopRisksNode> = [...values].map(([id, value]) => {
    const column = columnOf.get(id) ?? 'asset';
    const kind = residualKind(id);
    return {
      id,
      column,
      label: kind === null ? names.get(id) ?? '' : '',
      value,
      residualKind: kind,
      foldedCount: id === ASSET_TAIL_ID ? foldedAssets.size : id === SCENARIO_TAIL_ID ? foldedScenarios.size : 0,
      entityId: kind === null ? id.slice(`${column}:`.length) : null,
    };
  });

  return { nodes, items, total, scenarios: priced };
};

export type TopRisksNodeDetail =
  | { kind: 'asset', scenarioCount: number, sharedValue: number }
  | {
    kind: 'scenario',
    outcomeName: string,
    primaryAssetNames: Array<string>,
    aleP10: number | null,
    aleP90: number | null,
    lefMean: number | null,
  }
  | { kind: 'scenario-tail', scenarioCount: number }
  | { kind: 'outcome', scenarioCount: number, mainCategory: { node: TopRisksNode, share: number } | null }
  | { kind: 'category', mainOutcome: { node: TopRisksNode, share: number } | null };

const largest = (flow: TopRisksFlow, items: Array<TopRisksItem>, column: TopRisksColumn, of: number) => {
  const byNode = new Map<string, number>();
  for (const item of items) {
    addTo(byNode, item[column], item.value);
  }
  const [id, value] = [...byNode].toSorted((a, b) => b[1] - a[1]).at(0) ?? [null, 0];
  const node = flow.nodes.find((candidate) => candidate.id === id);
  return node === undefined || of <= 0 ? null : { node, share: value / of };
};

export const describeTopRisksNode = (flow: TopRisksFlow, node: TopRisksNode): TopRisksNodeDetail => {
  const through = flow.items.filter((item) => item[node.column] === node.id);
  const scenarioCount = new Set(through.map((item) => item.scenarioId)).size;
  switch (node.column) {
    case 'asset':
      return {
        kind: 'asset',
        scenarioCount,
        sharedValue: through.filter((item) => item.sharedAsset).reduce((sum, item) => sum + item.value, 0),
      };
    case 'scenario': {
      const scenario = node.entityId === null ? undefined : flow.scenarios.get(node.entityId);
      if (scenario === undefined) {
        return { kind: 'scenario-tail', scenarioCount };
      }
      return {
        kind: 'scenario',
        outcomeName: scenario.outcomeName,
        primaryAssetNames: scenario.primaryAssets.map((asset) => asset.name),
        aleP10: scenario.aleP10,
        aleP90: scenario.aleP90,
        lefMean: scenario.lefMean,
      };
    }
    case 'outcome':
      return { kind: 'outcome', scenarioCount, mainCategory: largest(flow, through, 'category', node.value) };
    case 'category':
      return { kind: 'category', mainOutcome: largest(flow, through, 'outcome', node.value) };
  }
};

export interface TopRisksGeometry {
  width: number,
  /** Room above the bars for the column titles. */
  head: number,
  height: number,
  gap: number,
  bar: number,
  columnX: [number, number, number, number],
  /** Width of each column's label: left of the bar for the primary assets, right of it elsewhere. */
  labelWidths: [number, number, number, number],
}

export const TOP_RISKS_BASE_GEOMETRY: TopRisksGeometry = {
  width: 896,
  head: 28,
  height: 440,
  gap: 8,
  bar: 14,
  columnX: [145, 303, 494, 657],
  labelWidths: [138, 165, 138, 217],
};

/** Stretches the columns over the width available; the type keeps its size, so narrower scrolls. */
export const topRisksGeometryForWidth = (available: number): TopRisksGeometry => {
  const base = TOP_RISKS_BASE_GEOMETRY;
  if (!(available > base.width)) {
    return base;
  }
  const factor = Math.floor(available) / base.width;
  const [assetX, scenarioX, outcomeX, categoryX] = base.columnX;
  const [assetLabel, scenarioLabel, outcomeLabel, categoryLabel] = base.labelWidths;
  return {
    ...base,
    width: Math.floor(available),
    columnX: [assetX * factor, scenarioX * factor, outcomeX * factor, categoryX * factor],
    labelWidths: [assetLabel * factor, scenarioLabel * factor, outcomeLabel * factor, categoryLabel * factor],
  };
};

export interface PositionedTopRisksNode extends TopRisksNode {
  x: number,
  y: number,
  height: number,
  /** Vertical centre of the label, moved off its bar's centre when a neighbour's label needs the room. */
  labelCenter: number,
  /** Two when the label has room to wrap, one when its neighbours crowd it. */
  labelLines: 1 | 2,
}

export interface TopRisksRibbon {
  key: string,
  outcome: string,
  path: string,
  /** The part of the ribbon that flows through the focused node, drawn over it; null when none. */
  focusPath: string | null,
}

export interface TopRisksLayout {
  geometry: TopRisksGeometry,
  nodes: Array<PositionedTopRisksNode>,
  ribbons: Array<TopRisksRibbon>,
  /** Nodes a focused flow passes through; null with nothing focused. */
  lit: Set<string> | null,
}

export const LABEL_LINE_HEIGHT = 14;

/** Centres pushed at least one line apart inside `[0, height]`, keeping their order. */
export const spreadLabelCenters = (centers: Array<number>, height: number): Array<number> => {
  const half = LABEL_LINE_HEIGHT / 2;
  const spread = [...centers];
  for (let index = 0; index < spread.length; index += 1) {
    const floor = index === 0 ? half : spread[index - 1] + LABEL_LINE_HEIGHT;
    spread[index] = Math.max(spread[index], floor);
  }
  for (let index = spread.length - 1; index >= 0; index -= 1) {
    const ceiling = index === spread.length - 1 ? height - half : spread[index + 1] - LABEL_LINE_HEIGHT;
    spread[index] = Math.min(spread[index], ceiling);
  }
  return spread;
};

const labelLines = (centers: Array<number>, index: number): 1 | 2 => {
  const room = Math.min(
    index === 0 ? Number.POSITIVE_INFINITY : centers[index] - centers[index - 1],
    index === centers.length - 1 ? Number.POSITIVE_INFINITY : centers[index + 1] - centers[index],
  );
  return room >= 2 * LABEL_LINE_HEIGHT ? 2 : 1;
};

const round = (value: number): number => Math.round(value * 10) / 10;

const ribbonPath = (x0: number, y0: number, x1: number, y1: number, thickness: number): string => {
  const xm = round((x0 + x1) / 2);
  /* eslint-disable lingui/no-unlocalized-strings -- SVG path data, not copy */
  return `M${round(x0)},${round(y0)} C${xm},${round(y0)} ${xm},${round(y1)} ${round(x1)},${round(y1)}`
    + ` L${round(x1)},${round(y1 + thickness)} C${xm},${round(y1 + thickness)} ${xm},${round(y0 + thickness)} ${round(x0)},${round(y0 + thickness)} Z`;
  /* eslint-enable lingui/no-unlocalized-strings */
};

/** Below this a focus overlay is thinner than a hairline and only adds noise. */
const MIN_FOCUS_THICKNESS = 0.05;

export const layoutTopRisks = (
  flow: TopRisksFlow,
  geometry: TopRisksGeometry,
  focusId: string | null,
): TopRisksLayout => {
  const focusColumn = flow.nodes.find((node) => node.id === focusId)?.column ?? null;
  const isFocused = (item: TopRisksItem): boolean => focusColumn !== null && item[focusColumn] === focusId;

  const byColumn = TOP_RISKS_COLUMNS.map((column) => flow.nodes
    .filter((node) => node.column === column)
    .toSorted((a, b) => Number(a.residualKind !== null) - Number(b.residualKind !== null) || b.value - a.value));
  const maxCount = Math.max(1, ...byColumn.map((nodes) => nodes.length));
  const usableHeight = Math.max(0, geometry.height - (maxCount - 1) * geometry.gap);
  const scale = flow.total > 0 ? usableHeight / flow.total : 0;

  const positioned = new Map<string, PositionedTopRisksNode>();
  byColumn.forEach((nodes, columnIndex) => {
    const stack = nodes.reduce((sum, node) => sum + node.value * scale, 0) + Math.max(0, nodes.length - 1) * geometry.gap;
    let y = (geometry.height - stack) / 2;
    const bars = nodes.map((node) => {
      const bar = { node, y, height: node.value * scale };
      y += bar.height + geometry.gap;
      return bar;
    });
    const centers = spreadLabelCenters(bars.map((bar) => bar.y + bar.height / 2), geometry.height);
    bars.forEach((bar, index) => {
      positioned.set(bar.node.id, {
        ...bar.node,
        x: geometry.columnX[columnIndex],
        y: bar.y,
        height: bar.height,
        labelCenter: centers[index],
        labelLines: labelLines(centers, index),
      });
    });
  });

  const outcomeRank = new Map(byColumn[2].map((node, index) => [node.id, index]));
  const ribbons: Array<TopRisksRibbon> = [];
  for (let index = 0; index < TOP_RISKS_COLUMNS.length - 1; index += 1) {
    const sourceColumn = TOP_RISKS_COLUMNS[index];
    const targetColumn = TOP_RISKS_COLUMNS[index + 1];
    const links = new Map<string, { source: string, target: string, outcome: string, value: number, focused: number }>();
    for (const item of flow.items) {
      const key = JSON.stringify([item[sourceColumn], item[targetColumn], item.outcome]);
      const link = links.get(key) ?? { source: item[sourceColumn], target: item[targetColumn], outcome: item.outcome, value: 0, focused: 0 };
      link.value += item.value;
      link.focused += isFocused(item) ? item.value : 0;
      links.set(key, link);
    }
    const ordered = [...links].toSorted(([, a], [, b]) =>
      (positioned.get(a.source)?.y ?? 0) - (positioned.get(b.source)?.y ?? 0)
      || (positioned.get(a.target)?.y ?? 0) - (positioned.get(b.target)?.y ?? 0)
      || (outcomeRank.get(a.outcome) ?? 0) - (outcomeRank.get(b.outcome) ?? 0));

    const outOffset = new Map<string, number>();
    const inOffset = new Map<string, number>();
    for (const [key, link] of ordered) {
      const source = positioned.get(link.source);
      const target = positioned.get(link.target);
      if (source === undefined || target === undefined) {
        continue;
      }
      const thickness = link.value * scale;
      const y0 = source.y + (outOffset.get(source.id) ?? 0);
      const y1 = target.y + (inOffset.get(target.id) ?? 0);
      outOffset.set(source.id, (outOffset.get(source.id) ?? 0) + thickness);
      inOffset.set(target.id, (inOffset.get(target.id) ?? 0) + thickness);
      const x0 = source.x + geometry.bar;
      const x1 = target.x;
      const focusThickness = link.focused * scale;
      ribbons.push({
        key,
        outcome: link.outcome,
        path: ribbonPath(x0, y0, x1, y1, thickness),
        focusPath: focusThickness > MIN_FOCUS_THICKNESS ? ribbonPath(x0, y0, x1, y1, focusThickness) : null,
      });
    }
  }

  let lit: Set<string> | null = null;
  if (focusColumn !== null) {
    lit = new Set();
    for (const item of flow.items.filter(isFocused)) {
      for (const column of TOP_RISKS_COLUMNS) {
        lit.add(item[column]);
      }
    }
  }

  return { geometry, nodes: [...positioned.values()], ribbons, lit };
};

/** Ribbon and outcome colours, keyed on the outcome name as the catalogue stores it. */
const OUTCOME_COLORS: Record<string, string> = {
  'Ransomware': '#d95926',
  'Data Theft Extortion': '#3987e5',
  'Financial Fraud & Funds Theft': '#c98500',
  'Service Disruption': '#008300',
  'Espionage': '#d55181',
  'Data Breach & Resale': '#8f6bd8',
  'Destructive Attack': '#14a3a3',
};

const FALLBACK_OUTCOME_COLOR = '#7f8794';

export const outcomeColor = (outcomeName: string): string => OUTCOME_COLORS[outcomeName] ?? FALLBACK_OUTCOME_COLOR;
