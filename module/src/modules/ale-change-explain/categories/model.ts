import type { ChangeCategory, ChangeEvent, ChangeValueFormat, ComparedRunRow } from '../types';
import { engineDifference } from '../change-values';

interface ModelSetting {
  key: string,
  format: ChangeValueFormat,
  read: (run: ComparedRunRow) => number | string | null,
}

/** Order-free: two runs naming the same corners in another order ran the same calibration. */
const cornerConstantsOf = (run: ComparedRunRow): string | null =>
  (run.cornerConstants === null ? null : run.cornerConstants.toSorted().join(', '));

const MODEL_SETTINGS: ReadonlyArray<ModelSetting> = [
  { key: 'calibration-vintage', format: 'text', read: (run) => run.calibrationVintage },
  { key: 'catalogue-vintage', format: 'text', read: (run) => run.catalogueVintage },
  { key: 'corner-constants', format: 'text', read: cornerConstantsOf },
  { key: 'iterations', format: 'count', read: (run) => run.iterations },
  { key: 'estate-mode', format: 'text', read: (run) => run.estateMode },
];

export const modelCategory: ChangeCategory = {
  key: 'model',
  tabs: ['ale', 'tef', 'susceptibility', 'magnitude'],
  resolve: ({ before, after }) => MODEL_SETTINGS.flatMap((setting): Array<ChangeEvent> => {
    const event = engineDifference({
      category: 'model',
      item: { kind: 'model-setting', key: setting.key, label: null, link: { kind: 'scenario-tab', tab: 'crq' } },
      format: setting.format,
      rise: 'none',
      before: setting.read(before.run),
      afterValue: setting.read(after.run),
    });
    return event === null ? [] : [event];
  }),
};
