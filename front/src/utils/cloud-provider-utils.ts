import { t } from '@lingui/core/macro';
import type { CloudProvider } from '@app/module/client';

export const getCloudProviderLabel = (provider: string): string => {
  const labels: Record<CloudProvider, string> = {
    aws: t`AWS`,
    azure: t`Azure`,
    gcp: t`Google Cloud`,
    oci: t`Oracle Cloud`,
    alibaba: t`Alibaba Cloud`,
    kubernetes: t`Kubernetes`,
    other: t`Other`,
  };
  return (labels as Record<string, string>)[provider] ?? provider;
};
