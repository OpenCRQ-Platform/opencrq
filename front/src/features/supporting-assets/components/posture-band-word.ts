import { t } from '@lingui/core/macro';
import type { PostureBand } from '@app/module/client';

/** What a posture gauge says out loud: the severity band it paints on is a colour, not a word — a
 * "strong" posture rides the `low` severity token, and hearing "low" would read as its opposite. */
export const postureBandWord = (band: PostureBand): string => {
  const words: Record<PostureBand, string> = {
    strong: t`strong`,
    moderate: t`moderate`,
    weak: t`weak`,
    critical: t`critical`,
  };
  return words[band];
};

/** The same word as a label, where a band is named on its own rather than inside a sentence. */
export const postureBandLabel = (band: PostureBand): string => {
  const labels: Record<PostureBand, string> = {
    strong: t`Strong`,
    moderate: t`Moderate`,
    weak: t`Weak`,
    critical: t`Critical`,
  };
  return labels[band];
};
