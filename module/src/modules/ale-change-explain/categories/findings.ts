import type { SeverityBand } from '../../finding-score/bands';
import type { CategoryResolverInput, ChangeCategory, ChangeCategoryKey, ChangeEvent, ChangeItem } from '../types';
import type { GroupMember } from './groups';
import { SEVERITY_BANDS } from '../../finding-score/bands';

const NO_BAND = 'none';

const bandPart = (band: SeverityBand | null): string => band ?? NO_BAND;

const categoryOf = (band: SeverityBand | null): ChangeCategoryKey => {
  switch (band) {
    case 'critical':
      return 'findings-critical';
    case 'high':
      return 'findings-high';
    case 'medium':
    case 'low':
    case null:
      return 'findings-other';
    default:
      return band satisfies never;
  }
};

/**
 * One change per CVE unique finding of the estate, in the band its unique score holds. A run read
 * before the journal's start lists none, since its trim leaves no reliable state there.
 */
export const resolveCveChanges = async (
  { before, after, riskScenarioId, uniqueScoreHistoryStart, repo }: CategoryResolverInput,
  touched?: { from: Date, to: Date },
): Promise<Array<GroupMember>> => {
  if (before.readAt < uniqueScoreHistoryStart) {
    return [];
  }
  const estate = await repo.findScenarioEstate(riskScenarioId);
  if (estate === undefined) {
    return [];
  }
  const window = { from: before.readAt, to: after.readAt };
  const rows = await repo.findUniqueFindingChanges(estate, window, touched);
  const left = rows.flatMap((row) => (row.assetsBefore !== null && row.assetsAfter === null ? [{ cveId: row.cveId, assetsBefore: row.assetsBefore }] : []));
  const noLongerReported = await repo.findCvesNoLongerReported(riskScenarioId, estate, left, window);

  return rows.flatMap((row): Array<GroupMember> => {
    const { bandBefore: from, bandAfter: to } = row;
    const dated = (at: Date | null): ChangeEvent['moment'] => ({ kind: 'recorded', at: (at ?? after.readAt).toISOString() });
    const item = (link: ChangeItem['link']): ChangeItem => ({ kind: 'cve', key: row.cveId, label: row.cveId, link });
    const uniqueFinding = item({ kind: 'cve', cveId: row.cveId });
    if (row.assetsBefore === null && row.assetsAfter !== null) {
      return [{
        assets: row.assetsAfter,
        event: {
          category: categoryOf(to),
          moment: dated(row.appearedAt),
          direction: 'up',
          item: uniqueFinding,
          sentence: { key: 'cve-appeared', parts: { count: row.assetsAfter, band: bandPart(to) } },
          values: null,
        },
      }];
    }
    if (row.assetsBefore !== null && row.assetsAfter === null) {
      return [{
        assets: row.assetsBefore,
        event: {
          category: categoryOf(from),
          moment: dated(row.leftAt),
          direction: 'down',
          // A CVE that left has no unique finding page to open.
          item: item({ kind: 'cve-findings', cveId: row.cveId, state: 'dismissed' }),
          sentence: {
            key: noLongerReported.has(row.cveId) ? 'cve-no-longer-reported' : 'cve-left',
            parts: { count: row.assetsBefore, band: bandPart(from) },
          },
          values: null,
        },
      }];
    }
    if (from === null || to === null || from === to) {
      return [];
    }
    const worsened = SEVERITY_BANDS.indexOf(to) < SEVERITY_BANDS.indexOf(from);
    return [{
      assets: row.assetsAfter ?? 0,
      event: {
        category: categoryOf(worsened ? to : from),
        moment: dated(row.bandMovedAt),
        direction: worsened ? 'up' : 'down',
        item: uniqueFinding,
        sentence: { key: 'cve-band-moved', parts: { from, to, band: worsened ? to : from } },
        values: null,
      },
    }];
  });
};

const resolveFindings = async (input: CategoryResolverInput): Promise<ReadonlyArray<ChangeEvent>> =>
  (await resolveCveChanges(input)).map((change) => change.event);

const findingsCategory = (key: ChangeCategoryKey): ChangeCategory => ({
  key,
  tabs: ['ale', 'susceptibility'],
  resolve: resolveFindings,
});

export const criticalFindingsCategory = findingsCategory('findings-critical');
export const highFindingsCategory = findingsCategory('findings-high');
export const otherFindingsCategory = findingsCategory('findings-other');
