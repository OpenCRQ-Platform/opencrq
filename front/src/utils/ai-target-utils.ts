import { t } from '@lingui/core/macro';
import type { AiTargetModality, AiTargetProvider } from '@app/module/client';

export const getAiTargetProviderLabel = (provider: string): string => {
  const labels: Record<AiTargetProvider, string> = {
    openai_compatible: t`OpenAI-compatible`,
    anthropic: t`Anthropic`,
    azure_openai: t`Azure OpenAI`,
    aws_bedrock: t`AWS Bedrock`,
    google_vertex: t`Google Vertex AI`,
    huggingface: t`Hugging Face`,
    ollama: t`Ollama`,
    custom_http: t`Custom HTTP`,
    mcp_server: t`MCP server`,
    agent_http: t`Agent (HTTP)`,
    xtm_one: t`XTM One`,
  };
  return (labels as Record<string, string>)[provider] ?? provider;
};

export const getAiTargetModalityLabel = (modality: string): string => {
  const labels: Record<AiTargetModality, string> = {
    text: t`Text`,
    vision: t`Vision`,
    audio: t`Audio`,
    multimodal: t`Multimodal`,
  };
  return (labels as Record<string, string>)[modality] ?? modality;
};
