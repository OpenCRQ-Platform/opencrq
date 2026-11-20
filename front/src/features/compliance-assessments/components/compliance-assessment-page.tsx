import type { MaturitySummary } from '@app/module/client';
import { summariseMaturity } from '@app/module/client';
import { Button, ProgressBar } from '@filigran/design-system';
import { msg, plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, EllipsisVertical, LockOpen } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { ComplianceAssessment } from './compliance-assessment-types';
import type { AnswerDrawerTarget } from './compliance-answer-drawer';
import {
  ConfirmDialog,
  DebouncedSearchField,
  DetailPageLayout,
  InfoTooltip,
  SectionCard,
} from '../../../components/shared';
import { DeleteConfirmDialog } from '../../../components/shared/delete-confirm-dialog';
import { IconActions, IconActionsItem } from '../../../components/shared/icon-actions';
import { useTRPC } from '../../../lib';
import { cn } from '../../../utils';
import {
  buildAssessmentTree,
  completedCount,
  completionPercent,
  fedControlCount,
  filterAssessmentTree,
  linksByRequirement,
  sectionIds,
} from '../compliance-assessments-utils';
import { AssessmentStatusChip } from '../ui/maturity-chips';
import { MaturityGauge } from '../ui/maturity-gauge';
import { averageMaturityLabel } from '../ui/maturity-labels';
import { AssessmentByline } from './assessment-byline';
import { ComplianceAnswerDrawer } from './compliance-answer-drawer';
import { ComplianceAssessmentRenameDrawer } from './compliance-assessment-rename-drawer';
import { ComplianceAssessmentTree } from './compliance-assessment-tree';

const HEADER_CARD_CLASS_NAME = cn('h-full');
const HEADER_PAPER_CLASS_NAME = cn('flex flex-1 flex-col justify-center');

const ProgressCard: FunctionComponent<{ maturity: MaturitySummary }> = ({ maturity }) => {
  const completed = completedCount(maturity);
  const total = maturity.requirementCount;
  const answered = maturity.answeredCount;
  const notApplicable = maturity.notApplicableCount;
  return (
    <SectionCard
      title={<Trans>Progress</Trans>}
      className={HEADER_CARD_CLASS_NAME}
      cardClassName={HEADER_PAPER_CLASS_NAME}
      contentClassName="gap-3"
    >
      <span className="txt-title font-semibold tabular-nums">
        <Trans>{completed} <span className="txt-default font-normal text-default-secondary">/ {total} requirements</span></Trans>
      </span>
      <ProgressBar value={completionPercent(maturity)} aria-label={t`Progress`} />
      <span className="txt-sub-content text-default-secondary">
        {t({ message: plural(answered, { one: '# answered', other: '# answered' }) })}
        {' · '}
        {t({ message: plural(notApplicable, { one: '# not applicable', other: '# not applicable' }) })}
      </span>
    </SectionCard>
  );
};

const MaturityCard: FunctionComponent<{ maturity: MaturitySummary }> = ({ maturity }) => (
  <SectionCard
    title={(
      <span className="flex items-center gap-1.5">
        <Trans>Average maturity</Trans>
        <InfoTooltip label={t`How the average maturity is computed`}>
          <Trans>The mean maturity level of the answered requirements, from 0 to 5. Unanswered and not applicable requirements are left out.</Trans>
        </InfoTooltip>
      </span>
    )}
    className={HEADER_CARD_CLASS_NAME}
    cardClassName={HEADER_PAPER_CLASS_NAME}
  >
    <MaturityGauge meanLevel={maturity.meanLevel} label={averageMaturityLabel(maturity.meanLevel)} />
  </SectionCard>
);

const ControlsFedCard: FunctionComponent<{ fed: number, reached: number }> = ({ fed, reached }) => (
  <SectionCard
    title={(
      <span className="flex items-center gap-1.5">
        <Trans>Controls fed</Trans>
        <InfoTooltip label={t`How the controls fed are counted`}>
          <Trans>The OpenCRQ controls reached by at least one requirement answered on a level, out of every control this framework reaches.</Trans>
        </InfoTooltip>
      </span>
    )}
    className={HEADER_CARD_CLASS_NAME}
    cardClassName={HEADER_PAPER_CLASS_NAME}
  >
    <span className="txt-title font-semibold tabular-nums">
      <Trans>{fed} <span className="txt-default font-normal text-default-secondary">/ {reached} controls</span></Trans>
    </span>
  </SectionCard>
);

export const ComplianceAssessmentPage: FunctionComponent<{ assessment: ComplianceAssessment }> = ({ assessment }) => {
  const trpc = useTRPC();
  const locked = assessment.status === 'published';
  const [search, setSearch] = useState('');
  const [unansweredOnly, setUnansweredOnly] = useState(false);
  const [feedsControlsOnly, setFeedsControlsOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [openRequirementId, setOpenRequirementId] = useState<string | null>(null);
  const [isPublishOpen, setPublishOpen] = useState(false);
  const [isReopenOpen, setReopenOpen] = useState(false);
  const [isRenameOpen, setRenameOpen] = useState(false);
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const navigate = useNavigate();

  const publishAssessment = useMutation(trpc.complianceAssessments.publishAssessment.mutationOptions({
    meta: { successMessage: msg`Assessment published successfully.` },
  }));
  const reopenAssessment = useMutation(trpc.complianceAssessments.reopenAssessment.mutationOptions({
    meta: { successMessage: msg`Assessment reopened successfully.` },
  }));
  const deleteAssessment = useMutation(trpc.complianceAssessments.deleteAssessment.mutationOptions({
    meta: { successMessage: msg`Assessment deleted successfully.` },
    onSuccess: () => void navigate({ from: '/$tenantId/{-$organizationId}', to: 'compliance/assessments' }),
  }));

  const answers = new Map(assessment.answers.map((answer) => [answer.requirementId, answer]));
  const tree = buildAssessmentTree(assessment.nodes, answers);
  const overall = summariseMaturity(tree.flatMap((entry) => entry.requirementIds), answers);
  const controlsByRequirement = linksByRequirement(assessment.controlLinks);
  const controlCounts = new Map([...controlsByRequirement].map(([requirementId, links]) => [requirementId, links.length]));
  const controlsFed = fedControlCount(assessment.controlLinks, answers);
  const filtering = search.trim() !== '' || unansweredOnly || feedsControlsOnly;
  const visibleTree = filterAssessmentTree(tree, answers, {
    search,
    unansweredOnly,
    feedingControls: feedsControlsOnly ? new Set(controlsByRequirement.keys()) : null,
  });
  const allSections = sectionIds(tree);
  const expanded = new Set(filtering ? sectionIds(visibleTree) : allSections.filter((id) => !collapsed.has(id)));
  const anyExpanded = expanded.size > 0;

  const toggleSection = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setCollapsed(next);
  };

  const nodesById = new Map(assessment.nodes.map((node) => [node.id, node]));
  const drawerTarget = ((): AnswerDrawerTarget | null => {
    const requirement = openRequirementId === null ? undefined : nodesById.get(openRequirementId);
    if (requirement === undefined) {
      return null;
    }
    const path = [];
    for (let parent = requirement.parentId === null ? undefined : nodesById.get(requirement.parentId);
      parent !== undefined;
      parent = parent.parentId === null ? undefined : nodesById.get(parent.parentId)) {
      path.unshift(parent);
    }
    return { requirement, path, answer: answers.get(requirement.id), controls: controlsByRequirement.get(requirement.id) ?? [] };
  })();

  return (
    <>
      <DetailPageLayout
        title={assessment.name}
        titleLeading={(
          <Link
            from="/$tenantId/{-$organizationId}"
            to="compliance/assessments"
            aria-label={t`Back to the assessments`}
            className="inline-flex h-8 w-8 items-center justify-center text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
        actions={(
          <div className="flex items-center gap-2">
            <AssessmentStatusChip status={assessment.status} />
            {locked && (
              <Button priority="secondary" startIcon={<LockOpen className="size-4" />} onClick={() => setReopenOpen(true)}>
                <Trans>Reopen</Trans>
              </Button>
            )}
            {!locked && (
              <>
                <Button onClick={() => setPublishOpen(true)}>
                  <Trans>Publish</Trans>
                </Button>
                <IconActions icon={<EllipsisVertical className="h-4 w-4" />} priority="secondary" size="md">
                  <IconActionsItem onClick={() => setRenameOpen(true)}>{t`Rename`}</IconActionsItem>
                  <IconActionsItem onClick={() => setDeleteOpen(true)}>{t`Delete`}</IconActionsItem>
                </IconActions>
              </>
            )}
          </div>
        )}
      >
        <AssessmentByline assessment={assessment} />
        <div className="grid grid-cols-3 gap-6">
          <ProgressCard maturity={overall} />
          <MaturityCard maturity={overall} />
          <ControlsFedCard fed={controlsFed.fed} reached={controlsFed.reached} />
        </div>
        <div className="flex items-center gap-2">
          <DebouncedSearchField
            placeholder={t`Search requirements...`}
            value={search}
            onCommit={setSearch}
            clearLabel={t`Clear search`}
            className="w-80"
          />
          <Button
            priority={unansweredOnly ? 'primary' : 'secondary'}
            aria-pressed={unansweredOnly}
            onClick={() => setUnansweredOnly(!unansweredOnly)}
          >
            <Trans>Unanswered</Trans>
          </Button>
          <Button
            priority={feedsControlsOnly ? 'primary' : 'secondary'}
            aria-pressed={feedsControlsOnly}
            onClick={() => setFeedsControlsOnly(!feedsControlsOnly)}
          >
            <Trans>Feeds controls</Trans>
          </Button>
          <span className="flex-1" />
          {!filtering && (
            <Button priority="tertiary" onClick={() => setCollapsed(new Set(anyExpanded ? allSections : []))}>
              {anyExpanded ? <Trans>Collapse all</Trans> : <Trans>Expand all</Trans>}
            </Button>
          )}
        </div>
        <ComplianceAssessmentTree
          tree={visibleTree}
          answers={answers}
          controlCounts={controlCounts}
          expanded={expanded}
          onToggle={toggleSection}
          onOpenRequirement={setOpenRequirementId}
        />
      </DetailPageLayout>
      <ComplianceAnswerDrawer
        assessmentId={assessment.id}
        locked={locked}
        target={drawerTarget}
        onClose={() => setOpenRequirementId(null)}
      />
      <ConfirmDialog
        open={isPublishOpen}
        onOpenChange={setPublishOpen}
        onConfirm={() => publishAssessment.mutate({ id: assessment.id })}
        title={<Trans>Publish the assessment?</Trans>}
        description={<Trans>It will be locked: its answers, owners and due dates can no longer change. Its answers will feed the linked controls.</Trans>}
        submitButtonText={<Trans>Publish</Trans>}
      />
      <ConfirmDialog
        open={isReopenOpen}
        onOpenChange={setReopenOpen}
        onConfirm={() => reopenAssessment.mutate({ id: assessment.id })}
        title={<Trans>Reopen the assessment?</Trans>}
        description={<Trans>It goes back to draft and can be edited again. Its publication date is cleared and its answers stop feeding the linked controls until it is published again.</Trans>}
        submitButtonText={<Trans>Reopen</Trans>}
      />
      <DeleteConfirmDialog
        open={isDeleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => deleteAssessment.mutate({ id: assessment.id })}
        title={<Trans>Delete the assessment?</Trans>}
        description={<Trans>This will permanently delete this assessment and all its answers, owners, due dates and comments. This action cannot be undone.</Trans>}
      />
      <ComplianceAssessmentRenameDrawer
        open={isRenameOpen}
        onOpenChange={setRenameOpen}
        assessmentId={assessment.id}
        name={assessment.name}
      />
    </>
  );
};
