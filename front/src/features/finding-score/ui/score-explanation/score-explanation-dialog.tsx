import { Button, Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { ScorePart } from '@app/module/client';
import { Info } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import { useState } from 'react';
import type { FindingScoreBreakdown } from '../finding-score-section';
import type { FactorSubject } from './factor-explanations';
import { cn } from '../../../../utils';
import { columnTitle } from '../column-vocabulary';
import { scorePartLabel } from '../factor-labels';
import { CompositionExplanation } from './composition-explanation';
import {
  ExploitationControlsExplanation,
  ImpactControlsExplanation,
  PotentialImpactExplanation,
  ReachabilityExplanation,
  ThreatExplanation,
} from './factor-explanations';
import { ExploitabilityExplanation, ImpactExplanation } from './part-explanations';

export type ExplanationSubject = 'score' | ScorePart | FactorSubject;

const subjectTitle = (subject: ExplanationSubject): string => {
  switch (subject) {
    case 'score': return t`Finding score`;
    case 'exploitability': case 'impact': return scorePartLabel(subject);
    case 'reachability': case 'threat': case 'potentialImpact': return columnTitle(subject);
    case 'exploitationControls': return t`Controls against the exploitation`;
    case 'impactControls': return t`Controls against the impact`;
  }
};

/**
 * One name per trigger, because a screen reader lists the buttons of a page side by side and
 * identical names name nothing.
 */
const subjectTriggerLabel = (subject: ExplanationSubject): string => {
  switch (subject) {
    case 'exploitability': return t`How the exploitability is computed`;
    case 'impact': return t`How the impact is computed`;
    case 'score': return t`How the finding score is computed`;
    case 'reachability': return t`How the reachability is computed`;
    case 'threat': return t`How the threat is computed`;
    case 'exploitationControls': return t`How the controls against the exploitation are computed`;
    case 'potentialImpact': return t`How the potential impact is computed`;
    case 'impactControls': return t`How the controls against the impact are computed`;
  }
};

const ExplanationBody: FunctionComponent<{
  subject: ExplanationSubject,
  finding: FindingScoreBreakdown,
}> = ({ subject, finding }) => {
  switch (subject) {
    case 'exploitability': return <ExploitabilityExplanation finding={finding} />;
    case 'impact': return <ImpactExplanation finding={finding} />;
    case 'score': return <CompositionExplanation finding={finding} />;
    case 'reachability': return <ReachabilityExplanation finding={finding} />;
    case 'threat': return <ThreatExplanation finding={finding} />;
    case 'exploitationControls': return <ExploitationControlsExplanation finding={finding} />;
    case 'potentialImpact': return <PotentialImpactExplanation finding={finding} />;
    case 'impactControls': return <ImpactControlsExplanation finding={finding} />;
  }
};

/**
 * The small "i" beside a score, and the modal it opens.
 *
 * It sits beside the name of what it explains, never beside the figure: the name says what is
 * about to be explained, and the corner of a panel is left to carry one thing, its score. A table
 * cell is the exception, where the column header names the figure and the "i" sits beside it.
 *
 * Each trigger owns its own dialog because there can be several on a page and nothing coordinates
 * them. Clicks on the "i" and in the dialog are swallowed so neither follows the link or the row
 * the "i" sits in, and `triggerLabel` must say which score it explains: a screen reader lists the
 * buttons of a page side by side.
 */
interface ExplanationDialogContent {
  title: string,
  /** What the explanation is about, under the title. */
  description?: string,
  /** Beside Close, for where the explanation leads next. */
  footerAction?: ReactNode,
  children: ReactNode,
}

/**
 * The explanation modal with no trigger of its own, for a surface that opens it from something
 * else than the "i", a matrix cell for one.
 */
export const ExplanationDialog: FunctionComponent<ExplanationDialogContent & {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  trigger?: ReactNode,
}> = ({ open, onOpenChange, trigger, title, description, footerAction, children }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    {trigger}
    <DialogContent onClick={(event) => event.stopPropagation()}>
      <DialogTitle>{title}</DialogTitle>
      {description !== undefined && <DialogDescription>{description}</DialogDescription>}
      <DialogBody className="flex flex-col gap-5 py-2">
        {children}
      </DialogBody>
      <DialogFooter>
        {footerAction}
        <DialogClose asChild>
          <Button priority="secondary"><Trans>Close</Trans></Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export const ExplanationDialogButton: FunctionComponent<ExplanationDialogContent & {
  triggerLabel: string,
  className?: string,
}> = ({ triggerLabel, className, ...content }) => {
  const [open, setOpen] = useState(false);

  return (
    <ExplanationDialog
      {...content}
      open={open}
      onOpenChange={setOpen}
      trigger={(
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={triggerLabel}
            onClick={(event) => event.stopPropagation()}
            className={cn(
              'inline-flex size-[18px] shrink-0 cursor-help items-center justify-center rounded-full border border-transparent text-default-secondary transition-colors hover:border-[color:var(--fds-border-elevation-subtle)] hover:text-[color:var(--fds-color-filigran-brand-primary)]',
              className,
            )}
          >
            <Info aria-hidden className="size-[13px]" />
          </button>
        </DialogTrigger>
      )}
    />
  );
};

export const ScoreInfoButton: FunctionComponent<{
  subject: ExplanationSubject,
  finding: FindingScoreBreakdown,
  className?: string,
}> = ({ subject, finding, className }) => (
  <ExplanationDialogButton triggerLabel={subjectTriggerLabel(subject)} title={subjectTitle(subject)} className={className}>
    <ExplanationBody subject={subject} finding={finding} />
  </ExplanationDialogButton>
);
