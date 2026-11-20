import { Button, IconButton } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Check, Copy, ExternalLink } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { SectionCard, TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { useCopyToClipboard } from '../../../hooks';
import { useXtmOneSettings } from '../hooks/use-xtm-one-settings';
import { toHttpUrl } from '../utils/to-http-url';

/**
 * "XTM One MCP server" profile card - shown only when the deployment is
 * connected to an XTM One instance (`xtm_one` config, surfaced by the
 * `xtmOne.getSettings` gate). Unlike the Ask Ariane launcher this is NOT
 * Enterprise-gated: the platform MCP servers are a full Community Edition
 * feature on the XTM One side.
 *
 * XTM One natively embeds an MCP (Model Context Protocol) server for every
 * registered platform: AI clients (Cursor, Claude Desktop, custom agents)
 * connect to `{xtm_one_url}/mcp/opencrq` with a personal XTM One API key and
 * work with OpenCRQ content (frameworks, controls, assessments, risk
 * scenarios) under the caller's own identity.
 */
export const XtmOneMcpCard: FunctionComponent = () => {
  const { copied, copy } = useCopyToClipboard();
  const { data: settings } = useXtmOneSettings();

  const xtmOneUrl = toHttpUrl(settings?.url);
  if (!settings?.configured || !xtmOneUrl) {
    return null;
  }

  const mcpEndpointUrl = `${xtmOneUrl}/mcp/opencrq`;
  const xtmOneProfileUrl = `${xtmOneUrl}/profile/mcp`;

  return (
    <SectionCard title={t`XTM One MCP server`}>
      <div className="flex flex-col gap-4">
        <p className="txt-sub-content text-muted-foreground">
          {t`This platform is connected to XTM One, which natively exposes an MCP (Model Context Protocol) server for OpenCRQ. AI clients such as Cursor or Claude Desktop can work with frameworks, controls, assessments and risk scenarios with your own permissions.`}
        </p>
        <div className="flex items-center gap-2">
          <code className="txt-body2 flex-1 truncate rounded border bg-muted px-3 py-2 font-mono select-all">
            {mcpEndpointUrl}
          </code>
          <TooltipHintProvider>
            <TooltipHint hint={t`Copy MCP endpoint URL`}>
              <IconButton
                priority="tertiary"
                aria-label={t`Copy MCP endpoint URL`}
                icon={copied
                  ? <Check className="size-4 text-green-600" />
                  : <Copy className="size-4" />}
                onClick={() => {
                  void copy(mcpEndpointUrl);
                }}
              />
            </TooltipHint>
          </TooltipHintProvider>
        </div>
        <p className="txt-sub-content text-muted-foreground">
          {t`Authenticate with a personal XTM One API key passed as a bearer token. Your endpoint, connection status and ready-to-copy client configuration are available in your XTM One profile.`}
        </p>
        <div className="flex justify-end">
          <Button priority="secondary" asChild>
            <a href={xtmOneProfileUrl} target="_blank" rel="noopener noreferrer">
              {t`Manage in XTM One`}
              <ExternalLink className="size-4" />
            </a>
          </Button>
        </div>
      </div>
    </SectionCard>
  );
};
