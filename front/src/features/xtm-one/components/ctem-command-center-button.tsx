import { IconButton, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { RadarOutlinedIcon } from '../../../components/shared/top-bar-icons';
import { useXtmOneSettings } from '../hooks/use-xtm-one-settings';
import { toHttpUrl } from '../utils/to-http-url';

/**
 * Top-bar shortcut to the XTM One CTEM Command Center (the cross-product
 * exposure posture dashboard / XTM One home), mirroring OpenCTI's
 * `CtemCommandCenterButton`. Opens the configured XTM One URL in a new tab.
 *
 * Shown only when the deployment is connected to an XTM One instance
 * (`xtm_one` config, surfaced by the `xtmOne.getSettings` gate). Unlike the
 * Ask Ariane launcher this is NOT Enterprise-gated: the CTEM Command Center
 * is also available in full Community Edition on the XTM One side.
 *
 * Drawn as OpenCTI's: the library IconButton in its `ia` variant at tertiary priority (AI purple hover
 * halo), the MUI `RadarOutlined` glyph at 24px painted `--color-filigran-ia-primary`. The `ia` variant
 * tints a label only, so the glyph colour is set on the glyph itself.
 */
export const CtemCommandCenterButton: FunctionComponent = () => {
  const { data: settings } = useXtmOneSettings();

  const xtmOneUrl = toHttpUrl(settings?.url);
  if (!settings?.configured || !xtmOneUrl) {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton
            variant="ia"
            priority="tertiary"
            aria-label={t`CTEM Command Center`}
            icon={<RadarOutlinedIcon className="text-filigran-ia-primary" />}
            onClick={() => window.open(xtmOneUrl, '_blank', 'noopener,noreferrer')}
          />
        </TooltipTrigger>
        <TooltipContent>{t`Open CTEM Command Center in XTM One`}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
