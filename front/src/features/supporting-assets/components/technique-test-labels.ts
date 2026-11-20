import { plural, t } from '@lingui/core/macro';
import type { ExpectationType } from '@app/module/client';
import type { TestTally } from './technique-tests-utils';
import { postureBandWord } from './posture-band-word';
import { heldPostureBand, heldShare } from './technique-tests-utils';

export const testTypeLabel = (type: ExpectationType): string => (type === 'prevention' ? t`Prevention` : t`Detection`);

export const tallyText = (type: ExpectationType, { held, total }: TestTally): string =>
  (type === 'prevention' ? t`Prevented ${held}/${total}` : t`Detected ${held}/${total}`);

export const tallyHereLabel = (type: ExpectationType, tally: TestTally | null): string => {
  if (tally === null) {
    return type === 'prevention' ? t`Prevention: never tested here` : t`Detection: never tested here`;
  }
  const { held, total } = tally;
  return type === 'prevention'
    ? t`Prevention: prevented ${held}/${total} on this asset`
    : t`Detection: detected ${held}/${total} on this asset`;
};

export const fleetTallyText = (type: ExpectationType, { held, total }: TestTally): string =>
  (type === 'prevention' ? t`Fleet: prevented ${held}/${total}` : t`Fleet: detected ${held}/${total}`);

export const assetTestScoreLabel = (type: ExpectationType, tally: TestTally): string => {
  const score = heldShare(tally);
  const word = postureBandWord(heldPostureBand(tally));
  return type === 'prevention'
    ? t`Prevention: ${score} out of 100, ${word}`
    : t`Detection: ${score} out of 100, ${word}`;
};

export const noAssetResultLabel = (type: ExpectationType): string =>
  (type === 'prevention' ? t`Prevention: no result on this asset` : t`Detection: no result on this asset`);

export const testedTechniquesText = (tested: number, shown: number): string =>
  plural(tested, { one: `# technique tested out of ${shown}`, other: `# techniques tested out of ${shown}` });

export const viewResultsText = (count: number): string =>
  plural(count, { one: 'View the # result', other: 'View the # results' });
