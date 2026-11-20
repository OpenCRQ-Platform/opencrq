import type { SeverityBand } from '../../finding-score/bands';
import type { CategoryResolverInput, ChangeCategory, ChangeCategoryKey, ChangeEvent, ChangeItem } from '../types';
import { postureBandForScore, postureSeverityBand, SEVERITY_BANDS } from '../../finding-score/bands';

type PostureLine = Awaited<ReturnType<CategoryResolverInput['repo']['findEstatePostureLines']>>[number];

/** `null` is an asset with no posture, no applicable finding left. */
const bandOf = (line: PostureLine): SeverityBand | null =>
  (line.score === null ? null : postureSeverityBand(postureBandForScore(line.score)));

const rank = (band: SeverityBand | null): number => (band === null ? -1 : SEVERITY_BANDS.length - SEVERITY_BANDS.indexOf(band));

const NO_POSTURE = 'none';

const bandPart = (band: SeverityBand | null): string => band ?? NO_POSTURE;

const categoryOf = (band: SeverityBand | null): ChangeCategoryKey => {
  switch (band) {
    case 'critical':
      return 'assets-critical';
    case 'high':
      return 'assets-high';
    case 'medium':
    case 'low':
    case null:
      return 'assets-other';
    default:
      return band satisfies never;
  }
};

const present = (value: string | null): string | null => (value === null || value.trim() === '' ? null : value);

/**
 * An asset with a line in force at the earlier run is listed when its band differs at the two
 * reading times alone: leaving its band then coming back lists nothing. An asset first measured
 * inside the window, including every asset when the posture history starts after the earlier run,
 * is listed once under the other assets, as first seen at the band it holds at the later run; a band
 * move from that first line is listed only when it reaches or leaves High or Critical. A band move
 * counts in the higher band held at either end, and is dated on the line from which the asset kept
 * its final band. With `touched`, only the assets holding a line in that span: a change is dated on
 * one of its lines.
 */
export const resolveAssetChanges = async (
  { before, after, riskScenarioId, repo }: CategoryResolverInput,
  touched?: { from: Date, to: Date },
): Promise<Array<ChangeEvent>> => {
  const estate = await repo.findScenarioEstate(riskScenarioId);
  if (estate === undefined) {
    return [];
  }
  const lines = await repo.findEstatePostureLines(estate, before.readAt, after.readAt, touched);
  const linesOf = Map.groupBy(lines, (line) => line.supportingAssetId);

  const events: Array<ChangeEvent> = [];
  for (const [supportingAssetId, assetLines] of linesOf) {
    const ordered = assetLines.toSorted((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
    const { name, derivedName } = ordered[0];
    const item: ChangeItem = {
      kind: 'asset',
      key: supportingAssetId,
      label: present(name) ?? present(derivedName),
      link: { kind: 'asset', supportingAssetId },
    };
    const firstSeen = ordered[0].changedAt > before.readAt;
    const from = bandOf(ordered[0]);
    const to = bandOf(ordered[ordered.length - 1]);
    if (firstSeen) {
      events.push({
        category: 'assets-other',
        moment: { kind: 'recorded', at: ordered[0].changedAt.toISOString() },
        direction: 'none',
        item,
        sentence: { key: 'posture-first-seen', parts: { band: bandPart(to) } },
        values: null,
      });
    }
    const category = categoryOf(rank(from) > rank(to) ? from : to);
    if (from === to || (firstSeen && category === 'assets-other')) {
      continue;
    }
    let anchor = ordered.length - 1;
    while (anchor > 1 && bandOf(ordered[anchor - 1]) === to) {
      anchor -= 1;
    }
    events.push({
      category,
      moment: { kind: 'recorded', at: ordered[anchor].changedAt.toISOString() },
      direction: rank(to) > rank(from) ? 'up' : 'down',
      item,
      sentence: { key: 'posture-band-moved', parts: { from: bandPart(from), to: bandPart(to) } },
      values: null,
    });
  }
  return events;
};

const assetPostureCategory = (key: ChangeCategoryKey): ChangeCategory => ({
  key,
  tabs: ['ale', 'susceptibility'],
  resolve: resolveAssetChanges,
});

export const criticalAssetsCategory = assetPostureCategory('assets-critical');
export const highAssetsCategory = assetPostureCategory('assets-high');
export const otherAssetsCategory = assetPostureCategory('assets-other');
