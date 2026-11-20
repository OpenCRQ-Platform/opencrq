import { Chip, Icon, Paper } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Shield } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import type { AssessmentAnswer, AssessmentNodeRow } from './compliance-assessment-types';
import type { AssessmentTreeNode } from '../compliance-assessments-utils';
import { EmptyValue } from '../../../components/ui/empty-value';
import { formatDate } from '../../../utils';
import { cn } from '../../../utils/cn';
import { AssessmentProgress } from '../ui/assessment-progress';
import { AnswerChip, MeanMaturityChip } from '../ui/maturity-chips';

const ROW_GRID_CLASS_NAME = cn('grid grid-cols-[150px_minmax(0,1fr)_150px_110px_90px_110px] items-center gap-x-4 px-5');

interface TreeProps {
  tree: Array<AssessmentTreeNode<AssessmentNodeRow>>,
  answers: ReadonlyMap<string, AssessmentAnswer>,
  /** Number of controls each requirement feeds; a requirement absent from it feeds none. */
  controlCounts: ReadonlyMap<string, number>,
  expanded: ReadonlySet<string>,
  onToggle: (id: string) => void,
  onOpenRequirement: (id: string) => void,
}

const personName = (person: AssessmentAnswer['owner']) => person?.name ?? person?.email ?? null;

const Indent: FunctionComponent<{ depth: number, children: ReactNode }> = ({ depth, children }) => (
  <span className="flex items-center gap-2" style={{ paddingLeft: depth * 20 }}>{children}</span>
);

const SectionRow: FunctionComponent<{
  entry: AssessmentTreeNode<AssessmentNodeRow>,
  depth: number,
  isOpen: boolean,
  onToggle: () => void,
}> = ({ entry, depth, isOpen, onToggle }) => (
  <div className={cn(ROW_GRID_CLASS_NAME, 'min-h-12 border-b border-[var(--fds-border-elevation-subtle-soft)]')}>
    <Indent depth={depth}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-label={isOpen ? t`Collapse section` : t`Expand section`}
        className="inline-flex size-6 items-center justify-center text-default-secondary hover:text-default-primary"
      >
        <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={16} />
      </button>
      <Chip label={entry.node.code} />
    </Indent>
    <span className={cn('font-medium', depth === 0 ? 'txt-default' : 'txt-sub-content')}>{entry.node.title}</span>
    <span className="col-span-2"><AssessmentProgress maturity={entry.maturity} /></span>
    <span />
    <span className="flex justify-end"><MeanMaturityChip meanLevel={entry.maturity.meanLevel} /></span>
  </div>
);

const ControlCount: FunctionComponent<{ count: number }> = ({ count }) => (
  count === 0
    ? <EmptyValue />
    : (
      <span className="txt-sub-content inline-flex items-center gap-1 tabular-nums text-primary" title={t({ message: plural(count, { one: 'Feeds # control', other: 'Feeds # controls' }) })}>
        <Shield className="size-3.5" aria-hidden />
        {count}
      </span>
    )
);

const RequirementRow: FunctionComponent<{
  entry: AssessmentTreeNode<AssessmentNodeRow>,
  depth: number,
  answer: AssessmentAnswer | undefined,
  controlCount: number,
  onOpen: () => void,
}> = ({ entry, depth, answer, controlCount, onOpen }) => {
  const owner = personName(answer?.owner ?? null);
  return (
    <div className={cn(ROW_GRID_CLASS_NAME, 'min-h-11 py-2 border-b border-[var(--fds-border-elevation-subtle-soft)] hover:bg-elevation-hover')}>
      <Indent depth={depth}>
        <span className="txt-sub-content font-content-code text-default-secondary">{entry.node.code}</span>
      </Indent>
      <button type="button" onClick={onOpen} className="txt-sub-content text-left text-primary hover:underline">
        {entry.node.title}
      </button>
      <span className="txt-sub-content truncate">{owner ?? <EmptyValue />}</span>
      <span className="txt-sub-content whitespace-nowrap">{answer?.dueDate ? formatDate(answer.dueDate) : <EmptyValue />}</span>
      <ControlCount count={controlCount} />
      <span className="flex justify-end">
        <AnswerChip level={answer?.level ?? null} notApplicable={answer?.notApplicable ?? false} />
      </span>
    </div>
  );
};

export const ComplianceAssessmentTree: FunctionComponent<TreeProps> = ({ tree, answers, controlCounts, expanded, onToggle, onOpenRequirement }) => {
  const renderEntries = (entries: Array<AssessmentTreeNode<AssessmentNodeRow>>, depth: number): Array<ReactNode> =>
    entries.flatMap((entry) => {
      if (entry.node.isRequirement) {
        return [(
          <RequirementRow
            key={entry.node.id}
            entry={entry}
            depth={depth}
            answer={answers.get(entry.node.id)}
            controlCount={controlCounts.get(entry.node.id) ?? 0}
            onOpen={() => onOpenRequirement(entry.node.id)}
          />
        )];
      }
      const isOpen = expanded.has(entry.node.id);
      return [
        <SectionRow key={entry.node.id} entry={entry} depth={depth} isOpen={isOpen} onToggle={() => onToggle(entry.node.id)} />,
        ...(isOpen ? renderEntries(entry.children, depth + 1) : []),
      ];
    });

  return (
    <Paper className="p-0 overflow-hidden">
      <div className={cn(ROW_GRID_CLASS_NAME, 'py-3 border-b border-[var(--fds-border-elevation-subtle-soft)] txt-container-title text-default-secondary')}>
        <span><Trans>Code</Trans></span>
        <span><Trans>Title</Trans></span>
        <span><Trans>Owner</Trans></span>
        <span><Trans>Due date</Trans></span>
        <span><Trans>Controls</Trans></span>
        <span className="text-right"><Trans>Maturity</Trans></span>
      </div>
      {tree.length === 0
        ? <p className="txt-sub-content px-5 py-6 text-default-secondary"><Trans>No requirement matches these filters.</Trans></p>
        : renderEntries(tree, 0)}
    </Paper>
  );
};
