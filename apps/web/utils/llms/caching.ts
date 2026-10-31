import type { JSONValue, ModelMessage } from "ai";
import { Provider } from "@/utils/llms/config";

type ProviderOptions = Record<string, Record<string, JSONValue>>;

// 这里的网关会把 `anthropic` 服务商选项透传给 Anthropic 模型。
const ANTHROPIC_CACHE_CONTROL_PROVIDERS = new Set<string>([
  Provider.ANTHROPIC,
  Provider.OPENROUTER,
  Provider.AI_GATEWAY,
]);

const OPENAI_PROMPT_CACHE_PROVIDERS = new Set<string>([
  Provider.OPEN_AI,
  Provider.AZURE,
  Provider.AZURE_FOUNDRY,
]);

export function getSystemCacheProviderOptions(
  provider: string,
  { cacheKey }: { cacheKey: string },
): ProviderOptions {
  if (OPENAI_PROMPT_CACHE_PROVIDERS.has(provider)) {
    return { openai: { promptCacheKey: cacheKey } };
  }
  // 没有密钥时，OpenRouter 的粘性路由会哈希第一条用户消息
  // （此处即邮件内容），因此同一账号的调用无法保持粘性。
  if (provider === Provider.OPENROUTER) {
    return { openrouter: { prompt_cache_key: cacheKey } };
  }
  return {};
}

export function buildCachedSystemMessages({
  system,
  prompt,
  provider,
}: {
  system: string;
  prompt: string;
  provider: string;
}): ModelMessage[] {
  const cacheMarker = getSystemMessageCacheMarker(provider);

  return [
    {
      role: "system",
      content: system,
      ...(cacheMarker ? { providerOptions: cacheMarker } : {}),
    },
    { role: "user", content: prompt },
  ];
}

function getSystemMessageCacheMarker(
  provider: string,
): ProviderOptions | undefined {
  if (ANTHROPIC_CACHE_CONTROL_PROVIDERS.has(provider)) {
    return { anthropic: { cacheControl: { type: "ephemeral" } } };
  }
  if (provider === Provider.BEDROCK) {
    return { bedrock: { cachePoint: { type: "default" } } };
  }
  return;
}
