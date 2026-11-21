/*
Copyright (c) 2026 Filigran SAS

This file is part of the OpenCRQ Enterprise Edition ("EE") and is
licensed under the OpenCRQ Enterprise Edition License (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://github.com/OpenCRQ-Platform/opencrq/blob/main/LICENSE

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

import { ChatPanel } from '@filigran/chatbot';
import type { ChatMode } from '@filigran/chatbot';
import '@filigran/chatbot/styles.css';
import {
  Button,
  Chip,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@filigran/design-system';
import { LogoXtmOneIcon } from '@filigran/icon';
import { t } from '@lingui/core/macro';
import { useLocation } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import type { CSSProperties, FunctionComponent, Ref } from 'react';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FDS_HEADER_HEIGHT } from '../../../components/layout/fds-header-height';
import { TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { useTheme } from '../../../providers';
import { useCanManagePlatform } from '../../../hooks/utils/use-can-manage-platform';
import { useEnterpriseEdition } from '../../edition';
import { xtmOneLicenseSettingsUrl } from '../../edition/filigran-license-utils';
import { useXtmOneSettings } from '../hooks/use-xtm-one-settings';
import { toHttpUrl } from '../utils/to-http-url';
import { useAskArianeLayout } from './ask-ariane-layout';
import { designSystemTokens } from './ask-ariane-tokens';

const CHAT_API_BASE = '/api/xtm-one/chat';

/*
 * Ask Ariane is an AI surface: it paints in the design system's AI purple
 * (`--color-filigran-ia-primary`: purple-300 dark, purple-500 light), as in
 * XTM One mode and in OpenCTI and OpenAEV. The panel takes the accent as a hex
 * (it derives its tints from it), so the two primitives are restated here.
 */
const AI_ACCENT = { dark: '#a47af0', light: '#651fe5' } as const;

/*
 * The design system controls inside the panel (icon highlight, Button, Chip
 * focus ring) paint from the host's brand family, the OpenCRQ blue. On the
 * portal the family is pointed at the AI purple, in both namespaces: the
 * panel's own build reads the plain names, this app's FDS build the `--fds-`
 * ones. The dark hover step lightens (purple-200) to keep AA under the dark
 * label, as XTM One does.
 */
const aiBrandFamily = (isDark: boolean): CSSProperties => {
  const accent = isDark ? AI_ACCENT.dark : AI_ACCENT.light;
  const secondary = isDark ? '#e3d6fa' : '#3c108c';
  const tertiary = isDark ? '#c3a8f5' : '#e3d6fa';
  const family: Record<string, string> = Object.fromEntries(['--', '--fds-'].flatMap((prefix) => [
    [`${prefix}color-filigran-brand-primary`, accent],
    [`${prefix}color-filigran-brand-secondary`, secondary],
    [`${prefix}color-filigran-brand-tertiary`, tertiary],
    [`${prefix}icon-highlight`, accent],
  ]));
  return family;
};

interface AskArianePanelProps {
  mode: ChatMode,
  firstName: string,
  xtmOneUrl: string | null,
  onClose: () => void,
  onModeChange: (mode: ChatMode) => void,
  onWidthChange?: (width: number) => void,
  onResizeStart?: () => void,
  onResizeEnd?: () => void,
}

const AskArianePanel: FunctionComponent<AskArianePanelProps> = ({
  mode,
  firstName,
  xtmOneUrl,
  onClose,
  onModeChange,
  onWidthChange,
  onResizeStart,
  onResizeEnd,
}) => {
  const location = useLocation();
  const { effectiveTheme } = useTheme();
  // ChatPanel sizes its composer from scrollHeight on mount, which reads 0 on
  // a detached node and pins the textarea at height 0: the portal target must
  // already be in the document when it mounts.
  return createPortal(
    <div
      id="ask-ariane-portal"
      className={effectiveTheme === 'dark' ? 'dark' : undefined}
      style={{ ...designSystemTokens(), ...aiBrandFamily(effectiveTheme === 'dark') }}
    >
      <ChatPanel
        mode={mode}
        accentColor={effectiveTheme === 'dark' ? AI_ACCENT.dark : AI_ACCENT.light}
        onClose={onClose}
        onModeChange={onModeChange}
        topOffset={FDS_HEADER_HEIGHT}
        backendType="rest"
        apiBaseUrl={CHAT_API_BASE}
        apiEndpoints={{
          agents: '/agents',
          messages: '/messages',
          steer: '/messages/steer',
          // Human-in-the-loop tool approval. Both have no default in the
          // chatbot on purpose: setting `approve` is what makes the panel
          // advertise `supports_tool_approval`, and that flag is a promise to
          // answer - XTM One then pauses the turn and waits indefinitely. They
          // must name routes the OpenCRQ proxy serves, never XTM One's paths.
          approve: '/messages/approve',
          // Read as `{apiBaseUrl}/conversations/{conversation_id}/pending-approvals`
          // to recover a prompt a reload dropped.
          pendingApprovals: '/conversations',
          sessions: '/sessions',
          upload: '/upload',
          download: '/files',
          // A deck, report or video card downloads it as `/artifacts/{kind}/{id}/download`
          // and follows a video still rendering on `/artifacts/{kind}/{id}`.
          artifacts: '/artifacts',
          // The composer's prompt picker and its credits indicator, as in
          // OpenCTI and OpenAEV: the panel hides either one when its route
          // fails or has nothing to show.
          prompts: '/prompts',
          quota: '/quota',
          // Unset, it defaults to a `/chat/*` route the OpenCRQ proxy does not serve.
          suggestions: null,
        }}
        user={{ firstName }}
        t={(key: string) => key}
        logoIcon={<LogoXtmOneIcon className="size-[1em]" />}
        // http(s)-only guard: a misconfigured XTM One URL (e.g. a
        // `javascript:` scheme) must never reach ChatPanel's link handling.
        agentDashboardUrl={toHttpUrl(xtmOneUrl) ?? undefined}
        promptSuggestions={[
          t`Summarize our compliance posture`,
          t`Which controls have the biggest maturity gaps?`,
          t`Help me draft a new risk scenario`,
          t`Explain the financial impact of this risk`,
        ]}
        // Forward the current in-app location (pathname only) so the agent
        // knows which page the question is asked from.
        pageContext={{ url: location.pathname }}
        resizable={mode === 'sidebar'}
        // The layout leaves this width free on the right, so the page is
        // pushed rather than covered (main-layout.tsx).
        onWidthChange={onWidthChange}
        onResizeStart={onResizeStart}
        onResizeEnd={onResizeEnd}
      />
    </div>,
    document.body,
  );
};

interface AskArianeButtonProps {
  isEnterpriseEdition: boolean,
  onClick: () => void,
  ref?: Ref<HTMLButtonElement>,
}

const AskArianeButton: FunctionComponent<AskArianeButtonProps> = ({ isEnterpriseEdition, onClick, ref }) => {
  const label = t`Ask Ariane - AI assistant`;
  return (
    <TooltipHintProvider>
      <TooltipHint hint={label}>
        <Button
          ref={ref}
          variant="ia"
          priority="tertiary"
          // As OpenCTI's AskArianeButton: the filigran-icon XTM One logo at 20px, painted plain AI purple. The `ia`
          // variant gradients the label only and the icon keeps `currentColor`, which is white in the dark header.
          startIcon={<LogoXtmOneIcon width={20} height={20} aria-hidden className="text-filigran-ia-primary" />}
          endIcon={isEnterpriseEdition ? undefined : <span aria-hidden><Chip label={t`EE`} severity="ee" size="sm" /></span>}
          aria-label={label}
          onClick={onClick}
        >
          {t`Ask Ariane`}
        </Button>
      </TooltipHint>
    </TooltipHintProvider>
  );
};

interface EnterpriseEditionDialogProps {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onCloseAutoFocus: (event: Event) => void,
  canManagePlatform: boolean,
  xtmOneUrl: string | null,
}

const EnterpriseEditionDialog: FunctionComponent<EnterpriseEditionDialogProps> = ({
  open,
  onOpenChange,
  onCloseAutoFocus,
  canManagePlatform,
  xtmOneUrl,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent size="sm" onCloseAutoFocus={onCloseAutoFocus}>
      <DialogTitle>{t`Ask Ariane is an Enterprise Edition feature`}</DialogTitle>
      <DialogDescription>
        {canManagePlatform
          ? t`Install the Filigran license in XTM One to switch this instance to Enterprise Edition.`
          : t`Ask an administrator to install the Filigran license in XTM One to switch this instance to Enterprise Edition.`}
      </DialogDescription>
      <DialogFooter>
        <DialogClose asChild>
          <Button priority="secondary">{t`Close`}</Button>
        </DialogClose>
        {canManagePlatform && xtmOneUrl !== null && (
          <Button asChild>
            <a href={xtmOneLicenseSettingsUrl(xtmOneUrl)} target="_blank" rel="noopener noreferrer">
              {t`Install the license in XTM One`}
              <ExternalLink className="size-4" aria-hidden />
            </a>
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

/** Never mounts the chat panel: every chat route refuses a Community platform. */
const CommunityEditionLauncher: FunctionComponent<{ xtmOneUrl: string | null }> = ({ xtmOneUrl }) => {
  const [open, setOpen] = useState(false);
  // Radix gives the focus back to a `DialogTrigger` only, and the launcher sits outside the dialog.
  const launcherRef = useRef<HTMLButtonElement>(null);
  // Read before the click, so the dialog never opens on the wrong audience's text.
  const canManagePlatform = useCanManagePlatform();
  return (
    <>
      <AskArianeButton ref={launcherRef} isEnterpriseEdition={false} onClick={() => setOpen(true)} />
      <EnterpriseEditionDialog
        open={open}
        onOpenChange={setOpen}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          launcherRef.current?.focus();
        }}
        canManagePlatform={canManagePlatform}
        xtmOneUrl={xtmOneUrl}
      />
    </>
  );
};

interface AskArianeLauncherProps {
  firstName: string,
  xtmOneUrl: string | null,
}

const AskArianeLauncher: FunctionComponent<AskArianeLauncherProps> = ({ firstName, xtmOneUrl }) => {
  // Inside the main layout the mode and width are shared with it, which makes
  // room for the docked panel; anywhere else the launcher keeps its own.
  const layout = useAskArianeLayout();
  const [ownMode, setOwnMode] = useState<ChatMode | null>(null);
  const mode = layout ? layout.mode : ownMode;
  const setMode = layout ? layout.setMode : setOwnMode;

  return (
    <>
      <AskArianeButton
        isEnterpriseEdition
        onClick={() => {
          setMode(mode ? null : 'sidebar');
        }}
      />
      {mode && (
        <AskArianePanel
          mode={mode}
          firstName={firstName}
          xtmOneUrl={xtmOneUrl}
          onClose={() => {
            setMode(null);
            layout?.setIsResizing(false);
          }}
          onModeChange={setMode}
          onWidthChange={layout?.setSidebarWidth}
          onResizeStart={() => layout?.setIsResizing(true)}
          onResizeEnd={() => layout?.setIsResizing(false)}
        />
      )}
    </>
  );
};

/**
 * "Ask Ariane" launcher - the embedded XTM One AI assistant, mirroring the
 * OpenCTI / OpenAEV integrations. Rendered in the header whenever the
 * deployment is connected to an XTM One instance (xtm_one config).
 *
 * On Enterprise Edition it opens the chat panel. On Community Edition it
 * carries an EE chip and explains that the Filigran license is installed in
 * XTM One, with a link there for a platform administrator. All chat traffic
 * is proxied through the OpenCRQ backend (session-cookie auth; the browser
 * never talks to XTM One directly).
 */
export const AskAriane: FunctionComponent<{ firstName: string }> = ({ firstName }) => {
  const { data: settings } = useXtmOneSettings();
  // Polls on the registration heartbeat cadence: the entitlement can flip at
  // runtime (granted or revoked on the XTM One side), and the launcher gate
  // should converge without waiting for a remount/refocus. The backend still
  // enforces EE on every chat route regardless.
  const eeEnabled = useEnterpriseEdition();

  if (settings?.configured !== true) {
    return null;
  }

  if (!eeEnabled) {
    return <CommunityEditionLauncher xtmOneUrl={toHttpUrl(settings.url)} />;
  }

  return (
    <AskArianeLauncher
      firstName={firstName}
      xtmOneUrl={settings.url}
    />
  );
};
