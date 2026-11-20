import { t } from '@lingui/core/macro';
import type { CategoryView } from './category-view';
import { formatThreat } from '../../overview/ale-decomposition-utils';

const readName = (key: string): string => {
  switch (key) {
    case 'country':
      return t`country`;
    case 'sector':
      return t`sector`;
    case 'size':
      return t`size class`;
    case 'catalogue':
      return t`catalog`;
    default:
      return key;
  }
};

const sizeSourceName = (source: string | number | undefined): string => {
  switch (source) {
    case 'employee_count':
      return t`from the employee count`;
    case 'revenue_band':
      return t`from the revenue band`;
    case 'none':
      return t`no size declared`;
    case undefined:
    default:
      return t`unknown`;
  }
};

const declared = (value: string | number | undefined): string => (value === undefined || value === '' ? t`none` : String(value));

/** A package as its id and version, a multiplier vintage in the reader's language. */
const catalogueName = (parts: Record<string, string | number>, side: 'before' | 'after'): string => {
  const vintage = parts[`${side}Vintage`];
  return vintage === undefined ? declared(parts[side]) : t`catalog vintage ${vintage}`;
};

const triplet = (parts: Record<string, string | number>, end: 'before' | 'after'): string =>
  [parts[`${end}Min`], parts[`${end}Likely`], parts[`${end}Max`]].map((value) => formatThreat(Number(value))).join(' / ');

export const attackFrequencyView: CategoryView = {
  label: () => t`Attack frequency`,
  itemName: (item) => {
    if (item.kind === 'tef-read') {
      const read = readName(item.key);
      return t`TEF ${read}`;
    }
    return item.key === 'mode' ? t`TEF mode` : t`Manual TEF`;
  },
  sentence: ({ sentence, item }) => {
    const { parts } = sentence;
    if (item.kind === 'tef-read') {
      const from = declared(parts.before);
      const to = declared(parts.after);
      switch (sentence.key) {
        case 'tef-catalogue-changed': {
          const fromCatalogue = catalogueName(parts, 'before');
          const toCatalogue = catalogueName(parts, 'after');
          return t`The TEF is now read from catalog ${toCatalogue}, it was ${fromCatalogue}`;
        }
        case 'tef-catalogue-version-changed':
          return t`The TEF is now read from catalog version ${to}, it was ${from}`;
        case 'tef-country-changed':
          return t`The TEF is now read for country ${to}, it was ${from}`;
        case 'tef-sector-changed':
          return t`The TEF is now read for sector ${to}, it was ${from}`;
        case 'tef-size-changed': {
          const fromSource = sizeSourceName(parts.beforeSource);
          const toSource = sizeSourceName(parts.afterSource);
          return t`The TEF is now read for size class ${to} (${toSource}), it was ${from} (${fromSource})`;
        }
        default:
          return item.key;
      }
    }
    const before = triplet(parts, 'before');
    const after = triplet(parts, 'after');
    switch (sentence.key) {
      case 'tef-manual-changed':
        return t`Manual TEF went from ${before} to ${after} per year`;
      case 'tef-mode-manual':
        return t`TEF switched from automatic to manual, from ${before} to ${after} per year`;
      case 'tef-mode-automatic':
        return t`TEF switched from manual to automatic, from ${before} to ${after} per year`;
      default:
        return item.key;
    }
  },
};
