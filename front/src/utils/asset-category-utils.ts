import { t } from '@lingui/core/macro';
import type { AssetCategory } from '@app/module/client';

export const getAssetCategoryLabel = (cat: string): string => {
  const labels: Record<AssetCategory, string> = {
    host: t`Host`,
    cloud_resource: t`Cloud resource`,
    network_device: t`Network device`,
    iot_ot_device: t`IoT / OT device`,
    saas_application: t`SaaS application`,
    web_application: t`Web application`,
    container_workload: t`Container / Workload`,
    mobile_device: t`Mobile device`,
    identity: t`Identity`,
    ai_target: t`AI target`,
    source_code: t`Source code`,
    security_platform: t`Security platform`,
    generic_asset: t`Generic asset`,
  };
  return (labels as Record<string, string>)[cat] ?? cat;
};

export const getAssetCategoryDescription = (cat: string): string => {
  const descriptions: Record<AssetCategory, string> = {
    host: t`Physical or virtual machine, server or workstation`,
    cloud_resource: t`Compute, storage, database, network or serverless cloud resource`,
    network_device: t`Router, switch, firewall, load balancer or other network gear`,
    iot_ot_device: t`IoT sensor, camera, PLC, SCADA or other operational technology`,
    saas_application: t`Software-as-a-Service application`,
    web_application: t`Website, web API or web service reachable over HTTP(S)`,
    container_workload: t`Container, image, Kubernetes object or serverless function`,
    mobile_device: t`Smartphone or tablet (iOS / Android)`,
    identity: t`User, service account, group or role`,
    ai_target: t`LLM models, AI agents, MCP servers, and RAG pipelines`,
    source_code: t`Code repository, pipeline or package your teams build and ship`,
    security_platform: t`EDR, SIEM, email security or other detection and prevention source`,
    generic_asset: t`Anything that does not fit another category yet`,
  };
  return (descriptions as Record<string, string>)[cat] ?? cat;
};
