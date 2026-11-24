import { Alert, Icon, IconButton } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { ReaderAccessIssue } from '../../xtm/use-reader-access';
import { TooltipHint, TooltipHintProvider } from '../../../components/shared/tooltip-hint';
import { useReaderAccess } from '../../xtm/use-reader-access';

const noticeText = (issue: ReaderAccessIssue): { title: string, description: string } => {
  switch (issue) {
    case 'not_linked':
      return {
        title: t`Some threats are hidden until OpenCTI is linked.`,
        description: t`OpenCTI is not linked to this platform's XTM One, so OpenCRQ cannot tell what you are allowed to see there. It shows threats from OpenCTI only when they carry no marking and no sharing restriction. Ask an administrator to link OpenCTI to XTM One, or to show every member what the connector reads.`,
      };
    case 'no_account':
      return {
        title: t`Some threats are hidden because you have no OpenCTI account.`,
        description: t`OpenCTI did not recognise you, most likely because it has no account for your email, so OpenCRQ shows threats from OpenCTI only when they carry no marking and no sharing restriction. Ask an OpenCTI administrator to create an account with the same email.`,
      };
    case 'unavailable':
      return {
        title: t`Some threats are hidden for now.`,
        description: t`OpenCTI or XTM One did not answer, so OpenCRQ shows threats from OpenCTI only when they carry no marking and no sharing restriction. They come back once the answer does. If this lasts, tell an administrator.`,
      };
  }
};

/** The notice of one category, for a screen that already holds it; a screen that does not uses `HiddenThreatsAlert`. */
export const ReaderAccessNotice: FunctionComponent<{ issue: ReaderAccessIssue }> = ({ issue }) => {
  const { title, description } = noticeText(issue);
  return <Alert severity="warning" title={title} description={description} />;
};

/** The notice of a screen that lists threats: reads the reader's access itself, and shows only while they miss some. */
export const HiddenThreatsAlert: FunctionComponent = () => {
  const { threats } = useReaderAccess();
  return threats ? <ReaderAccessNotice issue={threats} /> : null;
};

/**
 * The notice of a figure that counts threats, beside the figure: a smaller number is not read as a
 * fact. Nothing while the reader misses no threat.
 */
export const HiddenThreatsHint: FunctionComponent = () => {
  const { threats } = useReaderAccess();
  if (!threats) {
    return null;
  }
  const { title, description } = noticeText(threats);
  return (
    <TooltipHintProvider>
      <TooltipHint
        keepOpenOnPress
        hint={(
          <span className="flex max-w-72 flex-col gap-1">
            <span className="font-semibold">{title}</span>
            <span>{description}</span>
          </span>
        )}
      >
        <IconButton
          priority="tertiary"
          size="sm"
          aria-label={title}
          icon={<Icon name="triangle-alert" size={16} className="text-[color:var(--fds-color-feedback-alert-primary)]" aria-hidden />}
        />
      </TooltipHint>
    </TooltipHintProvider>
  );
};
