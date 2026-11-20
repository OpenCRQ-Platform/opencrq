import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { ScoreTermKey, SeverityBand } from '@app/module/client';
import { resolveSeverityBand } from '@app/module/client';
import type { FunctionComponent, ReactNode } from 'react';
import { ScoreGauge } from './score-gauge';
import { severityBandFigureColor, severityBandLabel } from './severity-ramp';

interface AnswerStripProps {
  score: number,
  band: SeverityBand,
  /** The two parts, already on the 0 to 100 figure the screen prints. */
  exploitability: number,
  impact: number,
  limitingTerm: ScoreTermKey,
  /** Sits after the title, for the arithmetic behind the conclusion. */
  titleAdornment?: ReactNode,
  /** Sits right of the sentence, past a hairline. */
  aside?: ReactNode,
}

const LimitingTerm: FunctionComponent<{ term: ScoreTermKey }> = ({ term }) => {
  switch (term) {
    case 'reachabilityAndThreat': return <Trans>Reachability and threat hold it back the most.</Trans>;
    case 'exploitationControls': return <Trans>The controls against the exploitation hold it back the most.</Trans>;
    case 'potentialImpact': return <Trans>The potential impact holds it back the most.</Trans>;
    case 'impactControls': return <Trans>The controls against the impact hold it back the most.</Trans>;
  }
};

const PartFigure: FunctionComponent<{ figure: number }> = ({ figure }) => (
  <b className="tabular-nums" style={{ color: severityBandFigureColor(resolveSeverityBand(figure)) }}>{figure}</b>
);

export const AnswerStrip: FunctionComponent<AnswerStripProps> = ({
  score,
  band,
  exploitability,
  impact,
  limitingTerm,
  titleAdornment,
  aside,
}) => {
  const bandWord = severityBandLabel(band);
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4 p-4">
      <ScoreGauge score={score} band={band} label={t`Finding score: ${score} out of 100, ${bandWord} band`} />
      <span className="flex min-w-0 max-w-[44rem] flex-1 flex-col justify-center gap-1.5">
        <span className="flex items-center gap-2.5">
          <span className="font-title-lg text-title-lg"><Trans>Finding score</Trans></span>
          {titleAdornment}
        </span>
        <span className="font-content-base text-content-base">
          <Trans>
            Exploitability, <PartFigure figure={exploitability} />, and impact, <PartFigure figure={impact} />, give {score}.
          </Trans>
          {' '}
          <LimitingTerm term={limitingTerm} />
        </span>
      </span>
      {aside !== undefined && (
        <div className="min-w-0 flex-[1.4_1_27.5rem] border-l border-[var(--fds-border-elevation-subtle)] pl-8">
          {aside}
        </div>
      )}
    </div>
  );
};
