import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { FunctionComponent } from 'react';
import { postureBandForScore, postureSeverityBand } from '@app/module/client';
import { KpiTile } from '../../../components/shared';
import { EmptyValue } from '../../../components/ui/empty-value';
import { ExplanationDialogButton, ScoreGaugeMark } from '../../finding-score';
import { CrqPostureExplanation } from './crq-posture-explanation';
import { postureBandWord } from './posture-band-word';

export type CrqPosture = NonNullable<inferRouterOutputs<TRPCRouter>['findingScore']['getAssetPosture']>;

interface CrqPostureTileProps {
  tenantId: string,
  /** `undefined` while it loads, `null` when the asset carries no scored applicable finding. */
  posture: CrqPosture | null | undefined,
  isLast?: boolean,
}

export const CrqPostureTile: FunctionComponent<CrqPostureTileProps> = ({ tenantId, posture, isLast }) => {
  const caption = t`OpenCRQ Posture`;
  if (posture === undefined || posture === null) {
    return (
      <KpiTile
        mark={(
          <span
            className="flex h-8 w-8 items-center justify-center font-content-base text-content-base text-default-secondary"
            title={posture === null ? t`OpenCRQ Posture: no applicable finding to measure` : undefined}
            aria-busy={posture === undefined}
          >
            <EmptyValue />
          </span>
        )}
        caption={caption}
        captionClassName="max-w-[7ch]"
        isLast={isLast}
      />
    );
  }

  const { score } = posture;
  const band = postureBandForScore(score);
  const word = postureBandWord(band);
  return (
    <KpiTile
      mark={(
        <ScoreGaugeMark
          score={score}
          band={postureSeverityBand(band)}
          label={i18n._({ id: 'OpenCRQ Posture score: {score} out of 100, {word}', message: 'OpenCRQ Posture score: {score} out of 100, {word}', values: { score, word } })}
        />
      )}
      caption={caption}
      captionClassName="max-w-[7ch]"
      captionAdornment={(
        <ExplanationDialogButton triggerLabel={t`How the OpenCRQ Posture is computed`} title={caption}>
          <CrqPostureExplanation tenantId={tenantId} posture={posture} />
        </ExplanationDialogButton>
      )}
      isLast={isLast}
    />
  );
};
