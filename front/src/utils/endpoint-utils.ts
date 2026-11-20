import { t } from '@lingui/core/macro';
import type { EndpointArch } from '@app/module/client';

/**
 * The OS family a machine-family asset's properties carry — `normalizePlatform`'s own closed
 * output set (`module/src/modules/supporting-assets/normalization.ts`), not a database enum:
 * anything it does not recognise (OpenAEV's `Generic`, `Internal`, `Unknown` included) is stored
 * as `null`, so an unrecognised string is never something this label has to cover.
 */
export const getEndpointPlatformLabel = (platform: string): string => {
  const labels: Record<string, string> = {
    windows: t`Windows`,
    macos: t`macOS`,
    linux: t`Linux`,
    android: t`Android`,
    ios: t`iOS`,
    container: t`Container`,
    service: t`Service`,
  };
  return labels[platform] ?? platform;
};

export const getEndpointArchLabel = (arch: string): string => {
  const labels: Record<EndpointArch, string> = {
    x86_64: t`x86_64`,
    arm64: t`ARM64`,
  };
  return (labels as Record<string, string>)[arch] ?? arch;
};
