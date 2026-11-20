import type { ChangeGroupKind, SeverityBand } from '@app/module/client';
import { plural, t } from '@lingui/core/macro';
import type { CategoryView } from './category-view';
import { severityBandLabel } from '../../../../finding-score/ui/severity-ramp';

const cveBandCount = (band: SeverityBand | null, count: number): string => {
  switch (band) {
    case 'critical':
      return t({ context: 'CVEs in a band', message: plural(count, { one: '# critical', other: '# critical' }) });
    case 'high':
      return t({ context: 'CVEs in a band', message: plural(count, { one: '# high', other: '# high' }) });
    case 'medium':
      return t({ context: 'CVEs in a band', message: plural(count, { one: '# medium', other: '# medium' }) });
    case 'low':
      return t({ context: 'CVEs in a band', message: plural(count, { one: '# low', other: '# low' }) });
    case null:
      return plural(count, { one: '# with no band', other: '# with no band' });
    default:
      return band satisfies never;
  }
};

const assetBandCount = (band: SeverityBand | null, count: number): string => {
  switch (band) {
    case 'critical':
      return t({ context: 'assets at a posture', message: plural(count, { one: '# critical', other: '# critical' }) });
    case 'high':
      return t({ context: 'assets at a posture', message: plural(count, { one: '# high', other: '# high' }) });
    case 'medium':
      return t({ context: 'assets at a posture', message: plural(count, { one: '# medium', other: '# medium' }) });
    case 'low':
      return t({ context: 'assets at a posture', message: plural(count, { one: '# low', other: '# low' }) });
    case null:
      return plural(count, { one: '# with no posture', other: '# with no posture' });
    default:
      return band satisfies never;
  }
};

const cveBandMoveCount = (from: SeverityBand | null, to: SeverityBand | null, count: number): string => {
  if (from === null || to === null) {
    return cveBandCount(to ?? from, count);
  }
  const fromLabel = severityBandLabel(from);
  const toLabel = severityBandLabel(to);
  return plural(count, { one: `# from ${fromLabel} to ${toLabel}`, other: `# from ${fromLabel} to ${toLabel}` });
};

const postureMoveCount = (from: SeverityBand | null, to: SeverityBand | null, count: number): string => {
  if (from !== null && to !== null) {
    const fromLabel = severityBandLabel(from);
    const toLabel = severityBandLabel(to);
    return plural(count, { one: `# from ${fromLabel} to ${toLabel}`, other: `# from ${fromLabel} to ${toLabel}` });
  }
  if (to !== null) {
    const toLabel = severityBandLabel(to);
    return plural(count, { one: `# from no posture to ${toLabel}`, other: `# from no posture to ${toLabel}` });
  }
  if (from !== null) {
    const fromLabel = severityBandLabel(from);
    return plural(count, { one: `# from ${fromLabel} to no posture`, other: `# from ${fromLabel} to no posture` });
  }
  return assetBandCount(null, count);
};

/** Counted from the bands, since a first measure counts neither up nor down. */
export const groupSentence: NonNullable<CategoryView['groupSentence']> = ({ kind, bands }) => {
  const count = bands.reduce((sum, band) => sum + band.count, 0);
  switch (kind) {
    case 'appeared':
      return {
        headline: plural(count, { one: '# CVE appeared', other: '# CVEs appeared' }),
        breakdown: bands.map((band) => cveBandCount(band.to, band.count)).join(', '),
      };
    case 'left':
      return {
        headline: plural(count, { one: '# CVE no longer applies', other: '# CVEs no longer apply' }),
        breakdown: bands.map((band) => cveBandCount(band.from, band.count)).join(', '),
      };
    case 'no-longer-reported':
      return {
        headline: plural(count, { one: '# CVE no longer reported', other: '# CVEs no longer reported' }),
        breakdown: bands.map((band) => cveBandCount(band.from, band.count)).join(', '),
      };
    case 'band-moved':
      return {
        headline: plural(count, { one: '# CVE changed band', other: '# CVEs changed band' }),
        breakdown: bands.map((band) => cveBandMoveCount(band.from, band.to, band.count)).join(', '),
      };
    case 'first-measured':
      return {
        headline: plural(count, { one: '# asset measured for the first time', other: '# assets measured for the first time' }),
        breakdown: bands.map((band) => assetBandCount(band.to, band.count)).join(', '),
      };
    case 'posture-moved':
      return {
        headline: plural(count, { one: '# asset changed posture', other: '# assets changed posture' }),
        breakdown: bands.map((band) => postureMoveCount(band.from, band.to, band.count)).join(', '),
      };
    default:
      return kind satisfies never;
  }
};

const ONE_SIDED_KINDS: ReadonlySet<ChangeGroupKind> = new Set(['appeared', 'left', 'no-longer-reported', 'first-measured']);

/** For a category of one band, a breakdown that would only repeat that band is left out. */
export const groupSentenceIn = (band: SeverityBand): NonNullable<CategoryView['groupSentence']> => (group) => {
  const sentence = groupSentence(group);
  const repeated = ONE_SIDED_KINDS.has(group.kind) && group.bands.every((entry) => (entry.to ?? entry.from) === band);
  return repeated ? { ...sentence, breakdown: '' } : sentence;
};
