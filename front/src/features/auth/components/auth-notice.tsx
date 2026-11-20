import { Paper, Text } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';
import { DisplayLogo } from '../../../components/shared/display-logo';
import { useTheme } from '../../../providers';

interface AuthNoticeProps {
  title?: string,
  description?: string,
  action: ReactNode,
}

/**
 * A page of its own around signing in, outside the application layout: what happened, and the one
 * thing to do. Laid out as OpenCTI's and OpenAEV's login, so the products read as one family.
 */
export const AuthNotice: FunctionComponent<AuthNoticeProps> = ({ title, description, action }) => {
  const { effectiveTheme } = useTheme();
  return (
    <div className="absolute inset-0 flex">
      <main className="relative z-[2] flex min-w-0 flex-1 flex-col items-center justify-center gap-8 bg-background px-4 shadow-[8px_0_9px_0_#0000002f] md:min-w-[500px]">
        <div className="w-[180px] [&_img]:h-auto [&_img]:w-full"><DisplayLogo /></div>
        <Paper className="flex w-[440px] max-w-full flex-col gap-4">
          {title && <Text as="h1" variant="title-md">{title}</Text>}
          {description && <Text as="p" variant="content-base" className="text-default-secondary">{description}</Text>}
          <div className="flex flex-col [&>*]:w-full">{action}</div>
        </Paper>
      </main>
      <aside className="relative flex-1 overflow-hidden max-md:hidden bg-[linear-gradient(100deg,#eaeaed_0%,#fefeff_100%)] dark:bg-[linear-gradient(100deg,#050a14_0%,#0c1728_100%)]">
        <img
          src={effectiveTheme === 'dark' ? '/filigran-emblem-dark.svg' : '/filigran-emblem-light.svg'}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute -top-10 -right-10 h-[calc(100%+80px)] w-auto max-w-none select-none"
        />
        <div className="absolute bottom-6 left-6 flex items-center gap-2 text-default-secondary">
          <Text as="span" variant="content-caption"><Trans>Made by</Trans></Text>
          <img alt={t`Filigran`} src={effectiveTheme === 'dark' ? '/filigran-dark.svg' : '/filigran-light.svg'} className="h-5 w-auto" />
        </div>
      </aside>
    </div>
  );
};
