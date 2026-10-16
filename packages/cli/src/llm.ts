import { cancel, group, isCancel, log, text } from "@clack/prompts";
import type { EnvConfig } from "./utils";

export const LLM_PROVIDER_OPTIONS = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI (ChatGPT)" },
  { value: "google", label: "Google (Gemini)" },
  {
    value: "openrouter",
    label: "OpenRouter",
    hint: "访问多个模型",
  },
  {
    value: "aigateway",
    label: "Vercel AI Gateway",
    hint: "访问多个模型",
  },
  { value: "bedrock", label: "AWS Bedrock" },
  { value: "groq", label: "Groq" },
  { value: "cerebras", label: "Cerebras", hint: "快速推理" },
  { value: "ollama", label: "Ollama", hint: "自托管" },
  {
    value: "openai-compatible",
    label: "OpenAI-Compatible",
    hint: "自托管（LM Studio、vLLM 等）",
  },
] as const;

const LLM_LINKS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/apikey",
  openrouter: "https://openrouter.ai/settings/keys",
  aigateway: "https://vercel.com/docs/ai-gateway",
  groq: "https://console.groq.com/keys",
  cerebras: "https://cloud.cerebras.ai",
};

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/api";

const DEFAULT_MODELS = {
  anthropic: {
    default: "claude-sonnet-5",
    economy: "claude-haiku-4-5",
  },
  openai: { default: "gpt-6-luna", economy: "gpt-6-luna" },
  google: {
    default: "gemini-3.8-flash",
    economy: "gemini-3.1-flash-lite",
  },
  openrouter: {
    default: "anthropic/claude-sonnet-5",
    economy: "openai/gpt-6-luna",
  },
  aigateway: {
    default: "anthropic/claude-sonnet-5",
    economy: "openai/gpt-6-luna",
  },
  bedrock: {
    default: "global.anthropic.claude-sonnet-5",
    economy: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
  },
  groq: {
    default: "llama-3.3-70b-versatile",
    economy: "llama-3.1-8b-instant",
  },
  cerebras: {
    default: "qwen-3.8-27b",
    economy: "gpt-oss-120b",
  },
} as const;

type DefaultModelProvider = keyof typeof DEFAULT_MODELS;

export function seedLlmPlaceholderCredentials(
  provider: string,
  env: EnvConfig,
): void {
  if (provider === "openai-compatible") {
    env.OPENAI_COMPATIBLE_BASE_URL = "http://localhost:1234/v1";
    env.OPENAI_COMPATIBLE_MODEL = "qwen3.5:4b";
    setRoleLlms(provider, env.OPENAI_COMPATIBLE_MODEL, env);
    env.LLM_API_KEY = "replace-me";
    return;
  }

  if (provider === "ollama") {
    env.OLLAMA_BASE_URL = DEFAULT_OLLAMA_BASE_URL;
    env.OLLAMA_MODEL = "qwen3.5:4b";
    setRoleLlms(provider, env.OLLAMA_MODEL, env);
    return;
  }

  const models = getDefaultLlmModels(provider);
  setRoleLlms(provider, models.default, env, models.economy);

  if (provider === "bedrock") {
    env.BEDROCK_ACCESS_KEY = "replace-me";
    env.BEDROCK_SECRET_KEY = "replace-me";
    env.BEDROCK_REGION = "us-west-2";
    return;
  }

  env.LLM_API_KEY = "replace-me";
}

export async function promptLlmCredentials(
  provider: string,
  env: EnvConfig,
): Promise<void> {
  if (provider === "openai-compatible") {
    const creds = await promptOpenAICompatibleCreds();
    env.OPENAI_COMPATIBLE_BASE_URL = creds.baseUrl;
    env.OPENAI_COMPATIBLE_MODEL = creds.model;
    if (creds.apiKey) env.LLM_API_KEY = creds.apiKey;
    setRoleLlms(provider, creds.model, env);
    return;
  }

  if (provider === "ollama") {
    const ollama = await promptOllamaCreds();
    env.OLLAMA_BASE_URL = ollama.baseUrl;
    env.OLLAMA_MODEL = ollama.model;
    setRoleLlms(provider, ollama.model, env);
    return;
  }

  const models = getDefaultLlmModels(provider);
  setRoleLlms(provider, models.default, env, models.economy);

  if (provider === "bedrock") {
    const bedrock = await promptBedrockCreds();
    env.BEDROCK_ACCESS_KEY = bedrock.accessKey;
    env.BEDROCK_SECRET_KEY = bedrock.secretKey;
    env.BEDROCK_REGION = bedrock.region;
    return;
  }

  env.LLM_API_KEY = await promptApiKey(provider);
}

export function getDefaultLlmModels(provider: string) {
  const models = DEFAULT_MODELS[provider as DefaultModelProvider];
  if (models) return models;

  throw new Error(`不支持的 LLM 提供商：${provider}`);
}

function setRoleLlms(
  provider: string,
  defaultModel: string,
  env: EnvConfig,
  economyModel = defaultModel,
) {
  env.DEFAULT_LLMS = `${provider}:${defaultModel}`;
  env.ECONOMY_LLMS = `${provider}:${economyModel}`;
}

function cancelSetup(): never {
  cancel("设置已取消。");
  process.exit(0);
}

async function promptOllamaCreds(): Promise<{
  baseUrl: string;
  model: string;
}> {
  const creds = await group(
    {
      baseUrl: () =>
        text({
          message: "Ollama 基础 URL",
          placeholder: DEFAULT_OLLAMA_BASE_URL,
          initialValue: DEFAULT_OLLAMA_BASE_URL,
        }),
      model: () =>
        text({
          message: "Ollama 模型",
          placeholder: "qwen3.5:4b",
          initialValue: "qwen3.5:4b",
          validate: (value) => (!value ? "模型名称为必填项" : undefined),
        }),
    },
    { onCancel: cancelSetup },
  );

  return {
    baseUrl: creds.baseUrl || DEFAULT_OLLAMA_BASE_URL,
    model: creds.model,
  };
}

async function promptOpenAICompatibleCreds(): Promise<{
  baseUrl: string;
  model: string;
  apiKey?: string;
}> {
  const creds = await group(
    {
      baseUrl: () =>
        text({
          message: "OpenAI 兼容的基础 URL",
          placeholder: "http://localhost:1234/v1",
          initialValue: "http://localhost:1234/v1",
        }),
      model: () =>
        text({
          message: "模型名称",
          placeholder: "qwen3.5:4b",
          initialValue: "qwen3.5:4b",
          validate: (value) => (!value ? "模型名称为必填项" : undefined),
        }),
      apiKey: () =>
        text({
          message: "API 密钥（可选，按回车跳过）",
          placeholder: "如不需要可留空",
        }),
    },
    { onCancel: cancelSetup },
  );

  return {
    baseUrl: creds.baseUrl || "http://localhost:1234/v1",
    model: creds.model,
    apiKey: creds.apiKey || undefined,
  };
}

async function promptBedrockCreds(): Promise<{
  accessKey: string;
  secretKey: string;
  region: string;
}> {
  log.info(
    "从 AWS 控制台获取你的 AWS 凭据：\nhttps://console.aws.amazon.com/iam/",
  );
  const creds = await group(
    {
      accessKey: () =>
        text({
          message: "Bedrock 访问密钥",
          placeholder: "AKIA...",
          validate: (value) => (!value ? "访问密钥为必填项" : undefined),
        }),
      secretKey: () =>
        text({
          message: "Bedrock 密钥",
          placeholder: "你的密钥",
          validate: (value) => (!value ? "密钥为必填项" : undefined),
        }),
      region: () =>
        text({
          message: "Bedrock 区域",
          placeholder: "us-west-2",
          initialValue: "us-west-2",
        }),
    },
    { onCancel: cancelSetup },
  );

  return {
    accessKey: creds.accessKey,
    secretKey: creds.secretKey,
    region: creds.region || "us-west-2",
  };
}

async function promptApiKey(provider: string): Promise<string> {
  log.info(`在此获取你的 API 密钥：\n${LLM_LINKS[provider]}`);
  const apiKey = await text({
    message: `${provider.charAt(0).toUpperCase() + provider.slice(1)} API 密钥`,
    placeholder: "在此粘贴你的 API 密钥",
    validate: (value) => (!value ? "API 密钥为必填项" : undefined),
  });

  if (isCancel(apiKey)) cancelSetup();
  return apiKey;
}
