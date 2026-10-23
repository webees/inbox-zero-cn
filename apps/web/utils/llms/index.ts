import {
  APICallError,
  type ModelMessage,
  type Tool,
  type ToolSet,
  ToolLoopAgent,
  type JSONValue,
  type FlexibleSchema,
  type InferSchema,
  type GenerateObjectResult,
  generateObject,
  generateText,
  RetryError,
  streamText,
  smoothStream,
  isStepCount,
  type StreamTextOnEndCallback,
  type GenerateTextOnStepEndCallback,
  type PrepareStepFunction,
  type StopCondition,
  NoObjectGeneratedError,
  TypeValidationError,
} from "ai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { captureAiGeneration } from "@posthog/ai";
import { jsonrepair } from "jsonrepair";
import { saveAiUsage } from "@/utils/usage";
import type { EmailAccountWithAI, UserAIFields } from "@/utils/llms/types";
import {
  addUserErrorMessageWithNotification,
  ErrorType,
  type PersistedErrorType,
} from "@/utils/error-messages";
import {
  attachLlmRepairMetadata,
  captureException,
  getAIApiCallError,
  isAnthropicInsufficientBalanceError,
  isContentFilterRefusal,
  isIncorrectAPIKeyError,
  isInsufficientCreditsError,
  isInvalidAIModelError,
  type LlmRepairMetadata,
  isAPIKeyDeactivatedError,
  isAiQuotaExceededError,
  markAsHandledUserKeyError,
  SafeError,
} from "@/utils/error";
import { hash } from "@/utils/hash";
import {
  getConfiguredRolePrimaryModel,
  getModel,
  type ModelType,
  type ResolvedModel,
  type SelectModel,
} from "@/utils/llms/model";
import { getModelForUseCase, type LlmUseCase } from "@/utils/llms/use-cases";
import {
  buildCachedSystemMessages,
  getSystemCacheProviderOptions,
} from "@/utils/llms/caching";
import {
  assertTrialAiUsageAllowed,
  shouldForceNanoModel,
} from "@/utils/llms/model-usage-guard";
import { Provider } from "@/utils/llms/config";
import { createClaudeCodeLanguageModelWithBridgedTools } from "@/utils/llms/cli-provider";
import {
  appendOllamaOnlySystemGuidance,
  OLLAMA_STRUCTURED_OUTPUT_GUIDANCE,
} from "@/utils/llms/ollama-guidance";
import { createScopedLogger } from "@/utils/logger";
import { getPosthogLlmClient, isPosthogLlmEvalApproved } from "@/utils/posthog";
import {
  applyPromptHardeningToMessages,
  applyPromptHardeningToSystem,
  type PromptHardening,
} from "@/utils/ai/security";
import {
  enforceSensitiveDataPolicy,
  enforceSensitiveToolOutputPolicy,
  redactSensitiveContentForLogging,
} from "@/utils/llms/sensitive-content";
import { resolveSensitiveDataPolicy } from "@/utils/dlp/policy.server";
import {
  extractLLMErrorInfo,
  isTransientNetworkError,
  withNetworkRetry,
  withLLMRetry,
} from "./retry";

const logger = createScopedLogger("llms");

const MAX_LOG_LENGTH = 200;

// Claude Code CLI 服务商会在 LanguageModelV4 边界丢弃 AI SDK 工具。
// 将带工具的调用路由到该包的 MCP 桥接，以便
// CLI can execute them locally; clear `tools` so the AI SDK does not also try
// 来驱动它们。对其他所有服务商以及无工具调用均为无操作。
async function bridgeClaudeCodeToolsIfNeeded<T extends Record<string, Tool>>({
  provider,
  modelName,
  model,
  tools,
  activeTools,
}: {
  provider: string;
  modelName: string;
  model: LanguageModelV4;
  tools: T | undefined;
  activeTools?: Array<string>;
}): Promise<{
  model: LanguageModelV4;
  tools: T | undefined;
  bridged: boolean;
}> {
  if (provider !== Provider.CLAUDE_CODE)
    return { model, tools, bridged: false };
  if (!tools || Object.keys(tools).length === 0) {
    return { model, tools, bridged: false };
  }

  const activeToolSet =
    activeTools === undefined ? undefined : new Set(activeTools);
  const toolsToBridge =
    activeToolSet === undefined
      ? tools
      : (Object.fromEntries(
          Object.entries(tools).filter(([name]) => activeToolSet.has(name)),
        ) as T);

  if (Object.keys(toolsToBridge).length === 0) {
    return { model, tools: undefined, bridged: true };
  }

  const bridged = await createClaudeCodeLanguageModelWithBridgedTools({
    modelName,
    tools: toolsToBridge as unknown as Record<
      string,
      {
        description?: string;
        inputSchema: unknown;
        execute?: (input: never, options?: unknown) => unknown;
      }
    >,
  });
  return { model: bridged, tools: undefined, bridged: true };
}

function prepareOptionsForToolBridge<TOptions extends { tools?: unknown }>({
  options,
  bridged,
}: {
  options: TOptions;
  bridged: { bridged: boolean };
}): TOptions {
  if (!bridged.bridged) return options;
  return { ...options, tools: undefined };
}

const NO_USER_AI_FIELDS: UserAIFields = {
  aiProvider: null,
  aiModel: null,
  aiApiKey: null,
};

type LLMProviderOptions = Record<string, Record<string, JSONValue>>;
type RepairCandidateKind = "original" | "trimmed" | "unwrapped" | "extracted";
type RepairResultKind = "object-or-array" | "string-wrapped-object-or-array";
type RepairAttemptState = {
  inputLength: number;
  inputFingerprint: string;
  startsWithQuote: boolean;
  startsWithBrace: boolean;
  startsWithBracket: boolean;
  looksCodeFenced: boolean;
  candidateKindsTried: RepairCandidateKind[];
  successfulCandidateKind?: RepairCandidateKind;
};

type LlmFallbackFailureCategory =
  | "content_filter"
  | "network"
  | "rate_limit"
  | "server_error"
  | "unknown";

type LlmFallbackFailure = {
  provider: string;
  model: string;
  category: LlmFallbackFailureCategory;
};

type ProviderCostSource = "openrouter_usage" | "openrouter_step_usage_sum";

type UsageMetadata = {
  providerReportedCost?: number;
  providerUpstreamInferenceCost?: number;
  providerCostSource?: ProviderCostSource;
  providerRequestIds?: string[];
  stepCount?: number;
  toolCallCount?: number;
};
type LlmEmailAccount = {
  sensitiveDataPolicy?: EmailAccountWithAI["sensitiveDataPolicy"];
  email: EmailAccountWithAI["email"];
  id: EmailAccountWithAI["id"];
  userId: EmailAccountWithAI["userId"];
};

export type ToolCallAgentResolvedModel = {
  modelName?: string;
  provider: string;
  providerOptions: LLMProviderOptions;
};

const commonOptions: {
  telemetry: { isEnabled: boolean };
  allowSystemInMessages: true;
  headers?: Record<string, string>;
  providerOptions?: LLMProviderOptions;
} = {
  telemetry: { isEnabled: true },
  // 聊天、缓存断点和提示加固仍会把系统
  // 指令放入 messages 数组。除非显式选择，AI SDK 7 会拒绝这种做法。
  allowSystemInMessages: true,
};

type ModelRouteSelection =
  | { modelType?: ModelType; useCase?: never }
  | { modelType?: never; useCase: LlmUseCase };

type BaseStreamOptions = ModelRouteSelection & {
  userAi: UserAIFields;
  messages: ModelMessage[];
  promptHardening: PromptHardening;
  maxSteps?: number;
  userId?: string;
  emailAccountId: string;
  userEmail: string;
  usageLabel: string;
  providerOptions?: LLMProviderOptions;
  sensitiveDataPolicy?: string | null;
};

type ChatCompletionStreamOptions = BaseStreamOptions & {
  tools?: Record<string, Tool>;
  onEnd?: StreamTextOnEndCallback<Record<string, Tool>>;
  onStepEnd?: GenerateTextOnStepEndCallback<Record<string, Tool>>;
};

type ToolCallAgentStreamOptions = BaseStreamOptions & {
  tools?: Record<string, Tool>;
  activeTools?: Array<string>;
  prepareStep?: PrepareStepFunction<Record<string, Tool>>;
  stopWhen?: StopCondition<Record<string, Tool>>;
  onEnd?: StreamTextOnEndCallback<Record<string, Tool>>;
  onStepEnd?: GenerateTextOnStepEndCallback<Record<string, Tool>>;
  onModelResolved?: (resolvedModel: ToolCallAgentResolvedModel) => void;
  temperature?: number;
  abortSignal?: AbortSignal;
};

export function createGenerateText({
  emailAccount,
  label,
  modelOptions,
  promptHardening,
  onModelUsed,
}: {
  emailAccount: LlmEmailAccount;
  label: string;
  modelOptions: ReturnType<typeof getModel>;
  promptHardening: PromptHardening;
  onModelUsed?: (candidate: {
    provider: string;
    modelName: string;
  }) => void | Promise<void>;
}): typeof generateText {
  return async (...args) => {
    const [options, ...restArgs] = args;
    const { modelOptions: effectiveModelOptions, modelCandidates } =
      await resolveModelCandidates({
        modelOptions,
        userEmail: emailAccount.email,
        userId: emailAccount.userId,
        emailAccountId: emailAccount.id,
        label,
      });

    const generate = async (candidate: ResolvedModel) => {
      const systemText = applyPromptHardeningToSystem({
        instructions:
          typeof options.instructions === "string"
            ? options.instructions
            : undefined,
        promptHardening,
      });
      const protectedOptions = enforceSensitiveDataPolicy({
        options: { ...options, instructions: systemText },
        policy: emailAccount.sensitiveDataPolicy,
        logger,
        label,
        userId: emailAccount.userId,
        emailAccountId: emailAccount.id,
      });
      const protectedTools = wrapToolsWithSensitiveDataPolicy({
        tools: protectedOptions.tools,
        policy: emailAccount.sensitiveDataPolicy,
        label,
        userId: emailAccount.userId,
        emailAccountId: emailAccount.id,
      });

      logger.trace("正在生成文本", {
        label,
        promptHardening,
        instructions: redactSensitiveContentForLogging(
          typeof protectedOptions.instructions === "string"
            ? protectedOptions.instructions
            : undefined,
        )?.slice(0, MAX_LOG_LENGTH),
        prompt: redactSensitiveContentForLogging(
          typeof protectedOptions.prompt === "string"
            ? protectedOptions.prompt
            : undefined,
        )?.slice(0, MAX_LOG_LENGTH),
      });

      const providerOptions = buildProviderOptions({
        provider: candidate.provider,
        modelProviderOptions: candidate.providerOptions as
          | LLMProviderOptions
          | undefined,
        requestProviderOptions: options.providerOptions as
          | LLMProviderOptions
          | undefined,
        userId: emailAccount.userId,
        label,
        emailAccountId: emailAccount.id,
      });

      const bridged = await bridgeClaudeCodeToolsIfNeeded({
        provider: candidate.provider,
        modelName: candidate.modelName,
        model: candidate.model,
        tools: protectedTools,
      });
      const protectedRequestOptions = prepareOptionsForToolBridge({
        options: protectedOptions,
        bridged,
      });

      const result = await generateText(
        {
          ...protectedRequestOptions,
          ...(bridged.tools ? { tools: bridged.tools } : {}),
          ...commonOptions,
          telemetry: buildLlmTelemetry({
            userEmail: emailAccount.email,
            userId: emailAccount.userId,
            emailAccountId: emailAccount.id,
            label,
            provider: candidate.provider,
            modelName: candidate.modelName,
          }),
          providerOptions,
          model: bridged.model,
        },
        ...restArgs,
      );

      if (result.usage) {
        await saveUsageWithMetadata({
          result,
          usage: result.usage,
          userId: emailAccount.userId,
          email: emailAccount.email,
          emailAccountId: emailAccount.id,
          provider: candidate.provider,
          model: candidate.modelName,
          label,
          hasUserApiKey: effectiveModelOptions.hasUserApiKey,
        });
      }

      await onModelUsed?.({
        provider: candidate.provider,
        modelName: candidate.modelName,
      });

      if (options.tools) {
        const toolCallInput = result.toolCalls?.[0]?.input;
        logger.trace("Result", {
          label,
          result: toolCallInput,
        });
      }

      return result;
    };

    for (let index = 0; index < modelCandidates.length; index++) {
      const candidate = modelCandidates[index];
      const nextCandidate = modelCandidates[index + 1];

      try {
        return await withLLMRetry(
          () => withNetworkRetry(() => generate(candidate), { label }),
          { label },
        );
      } catch (error) {
        if (error instanceof SafeError) throw error;

        if (nextCandidate && shouldFallbackToNextModel(error)) {
          logger.warn("LLM 调用失败，尝试备用模型", {
            label,
            provider: candidate.provider,
            model: candidate.modelName,
            fallbackProvider: nextCandidate.provider,
            fallbackModel: nextCandidate.modelName,
            error,
          });
          continue;
        }

        await handleError(
          error,
          emailAccount.userId,
          emailAccount.email,
          emailAccount.id,
          label,
          candidate.modelName,
          effectiveModelOptions.hasUserApiKey,
        );
        throw error;
      }
    }

    throw new Error("没有可用于生成的模型");
  };
}

export function createGenerateObject({
  emailAccount,
  label,
  modelOptions,
  promptHardening,
  cacheSystemPrompt,
  onModelUsed,
}: {
  emailAccount: LlmEmailAccount;
  label: string;
  modelOptions: ReturnType<typeof getModel>;
  promptHardening: PromptHardening;
  // 仅当某账号的系统提示词在多次请求间保持稳定时才设置。
  cacheSystemPrompt?: boolean;
  onModelUsed?: (candidate: {
    provider: string;
    modelName: string;
  }) => void | Promise<void>;
}): typeof generateObject {
  return async function generateWithFallback<
    SCHEMA extends FlexibleSchema<unknown> = FlexibleSchema<JSONValue>,
    OUTPUT extends
      | "object"
      | "array"
      | "enum"
      | "no-schema" = InferSchema<SCHEMA> extends string ? "enum" : "object",
    RESULT = OUTPUT extends "array"
      ? Array<InferSchema<SCHEMA>>
      : InferSchema<SCHEMA>,
  >(
    options: Parameters<typeof generateObject<SCHEMA, OUTPUT, RESULT>>[0],
  ): Promise<GenerateObjectResult<RESULT>> {
    const { modelOptions: effectiveModelOptions, modelCandidates } =
      await resolveModelCandidates({
        modelOptions,
        userEmail: emailAccount.email,
        userId: emailAccount.userId,
        emailAccountId: emailAccount.id,
        label,
      });
    let latestRepairAttempt: RepairAttemptState | undefined;
    const fallbackFailures: LlmFallbackFailure[] = [];

    const generate = async (candidate: ResolvedModel) => {
      const systemText = applyPromptHardeningToSystem({
        instructions:
          typeof options.instructions === "string"
            ? options.instructions
            : undefined,
        promptHardening,
      });
      const protectedOptions = appendOllamaOnlySystemGuidance(
        enforceSensitiveDataPolicy({
          options: { ...options, instructions: systemText },
          policy: emailAccount.sensitiveDataPolicy,
          logger,
          label,
          userId: emailAccount.userId,
          emailAccountId: emailAccount.id,
        }),
        candidate,
        OLLAMA_STRUCTURED_OUTPUT_GUIDANCE,
      );

      logger.trace("正在生成对象", {
        label,
        promptHardening,
        instructions: redactSensitiveContentForLogging(
          typeof protectedOptions.instructions === "string"
            ? protectedOptions.instructions
            : undefined,
        )?.slice(0, MAX_LOG_LENGTH),
        prompt: redactSensitiveContentForLogging(
          typeof protectedOptions.prompt === "string"
            ? protectedOptions.prompt
            : undefined,
        )?.slice(0, MAX_LOG_LENGTH),
      });

      // 仅对提示词形态的调用发出警告。消息形态的调用方（没有
      // `prompt` string) are out of scope; scanning every message for
      // 字面量 "JSON" 会既脆弱又嘈杂。
      const systemIncludesJson =
        typeof protectedOptions.instructions === "string" &&
        protectedOptions.instructions.includes("JSON");
      if (
        !systemIncludesJson &&
        typeof protectedOptions.prompt === "string" &&
        !protectedOptions.prompt.includes("JSON")
      ) {
        logger.warn("提示词中缺少 JSON", { label });
      }

      const providerOptions = buildProviderOptions({
        provider: candidate.provider,
        modelProviderOptions: candidate.providerOptions as
          | LLMProviderOptions
          | undefined,
        requestProviderOptions: options.providerOptions as
          | LLMProviderOptions
          | undefined,
        userId: emailAccount.userId,
        label,
        emailAccountId: emailAccount.id,
      });

      // 在加固和 DLP 之后构建，使缓存的字节与服务商看到的一致。
      const cacheOverrides = cacheSystemPrompt
        ? buildSystemPromptCacheOverrides({
            protectedOptions,
            providerOptions,
            provider: candidate.provider,
            cacheKey: emailAccount.id,
          })
        : undefined;

      const request = {
        repairText: async ({ text }: { text: string }) => {
          logger.info("正在修复文本", { label });
          const repairResult = repairObjectText(text, label);
          latestRepairAttempt = repairResult.attempt;
          return repairResult.text;
        },
        ...protectedOptions,
        ...commonOptions,
        telemetry: buildLlmTelemetry({
          userEmail: emailAccount.email,
          userId: emailAccount.userId,
          emailAccountId: emailAccount.id,
          label,
          provider: candidate.provider,
          modelName: candidate.modelName,
        }),
        providerOptions,
        model: candidate.model,
        ...(cacheOverrides ?? {}),
      } as unknown as Parameters<
        typeof generateObject<SCHEMA, OUTPUT, RESULT>
      >[0];

      let result: GenerateObjectResult<RESULT>;

      try {
        result = await generateObject<SCHEMA, OUTPUT, RESULT>(request);
      } catch (error) {
        if (
          NoObjectGeneratedError.isInstance(error) &&
          error.usage !== undefined
        ) {
          try {
            await saveUsageWithMetadata({
              result: error,
              usage: error.usage,
              userId: emailAccount.userId,
              email: emailAccount.email,
              emailAccountId: emailAccount.id,
              provider: candidate.provider,
              model: candidate.modelName,
              label,
              hasUserApiKey: effectiveModelOptions.hasUserApiKey,
            });
          } catch (usageError) {
            logger.error("为失败的对象生成保存用量记录失败", {
              error: usageError,
              label,
              provider: candidate.provider,
              model: candidate.modelName,
            });
          }
        }

        throw error;
      }

      if (result.usage) {
        try {
          await saveUsageWithMetadata({
            result,
            usage: result.usage,
            userId: emailAccount.userId,
            email: emailAccount.email,
            emailAccountId: emailAccount.id,
            provider: candidate.provider,
            model: candidate.modelName,
            label,
            hasUserApiKey: effectiveModelOptions.hasUserApiKey,
          });
        } catch (usageError) {
          logger.error("保存对象生成用量记录失败", {
            error: usageError,
            label,
            provider: candidate.provider,
            model: candidate.modelName,
          });
        }
      }

      await onModelUsed?.({
        provider: candidate.provider,
        modelName: candidate.modelName,
      });

      logger.trace("已生成对象", {
        label,
        result: result.object,
      });

      return result;
    };

    for (let index = 0; index < modelCandidates.length; index++) {
      const candidate = modelCandidates[index];
      const nextCandidate = modelCandidates[index + 1];
      latestRepairAttempt = undefined;

      try {
        const result = await withLLMRetry(
          () =>
            withNetworkRetry(() => generate(candidate), {
              label,
              shouldRetry: (error) =>
                (NoObjectGeneratedError.isInstance(error) &&
                  !isContentFilterRefusal(error)) ||
                TypeValidationError.isInstance(error),
            }),
          { label },
        );

        logger.info("LLM 对象生成完成", {
          label,
          candidateCount: modelCandidates.length,
          fallbackUsed: index > 0,
          fallbackDepth: index,
          selectedProvider: candidate.provider,
          selectedModel: candidate.modelName,
          attemptedModels: modelCandidates
            .slice(0, index + 1)
            .map(getResolvedModelKey),
          failedModels: fallbackFailures.map(
            ({ provider, model }) => `${provider}:${model}`,
          ),
          failureCategories: fallbackFailures.map(({ category }) => category),
        });

        return result;
      } catch (error) {
        if (error instanceof SafeError) throw error;

        attachLlmRepairMetadata(
          error,
          buildRepairMetadata({
            attempt: latestRepairAttempt,
            label,
            provider: candidate.provider,
            model: candidate.modelName,
          }),
        );

        if (nextCandidate && shouldFallbackToNextModel(error)) {
          fallbackFailures.push({
            provider: candidate.provider,
            model: candidate.modelName,
            category: getLlmFallbackFailureCategory(error),
          });
          logger.warn("LLM 对象生成失败，尝试备用模型", {
            label,
            provider: candidate.provider,
            model: candidate.modelName,
            fallbackProvider: nextCandidate.provider,
            fallbackModel: nextCandidate.modelName,
            error,
          });
          continue;
        }

        await handleError(
          error,
          emailAccount.userId,
          emailAccount.email,
          emailAccount.id,
          label,
          candidate.modelName,
          effectiveModelOptions.hasUserApiKey,
        );
        throw error;
      }
    }

    throw new Error("没有可用于生成的模型");
  };
}

export async function chatCompletionStream(
  options: ChatCompletionStreamOptions,
) {
  const {
    messages,
    promptHardening,
    tools,
    maxSteps,
    userId,
    emailAccountId,
    userEmail,
    usageLabel: label,
    providerOptions: requestProviderOptions,
    sensitiveDataPolicy,
    onEnd,
    onStepEnd,
  } = options;
  const { modelOptions, modelCandidates } = await resolveModelCandidates({
    modelOptions: getModelOptionsForRoute(options),
    userEmail,
    userId,
    emailAccountId,
    label,
  });
  const hardenedMessages = applyPromptHardeningToMessages({
    messages,
    promptHardening,
  });
  const protectedMessages = enforceSensitiveDataPolicy({
    options: { messages: hardenedMessages },
    policy: sensitiveDataPolicy,
    logger,
    label,
    userId,
    emailAccountId,
  }).messages;

  for (let index = 0; index < modelCandidates.length; index++) {
    const candidate = modelCandidates[index];
    const nextCandidate = modelCandidates[index + 1];
    const providerOptions = buildProviderOptions({
      provider: candidate.provider,
      modelProviderOptions: candidate.providerOptions as
        | LLMProviderOptions
        | undefined,
      requestProviderOptions,
      userId,
      label,
      emailAccountId,
    });
    const protectedChatTools = wrapToolsWithSensitiveDataPolicy({
      tools,
      policy: sensitiveDataPolicy,
      label,
      userId,
      emailAccountId,
    });
    const bridgedChat = await bridgeClaudeCodeToolsIfNeeded({
      provider: candidate.provider,
      modelName: candidate.modelName,
      model: candidate.model,
      tools: protectedChatTools,
    });
    try {
      return streamText({
        model: bridgedChat.model,
        messages: protectedMessages as ModelMessage[],
        tools: bridgedChat.tools,
        stopWhen: maxSteps ? isStepCount(maxSteps) : undefined,
        ...commonOptions,
        telemetry: buildLlmTelemetry({
          userEmail,
          userId,
          emailAccountId,
          label,
          provider: candidate.provider,
          modelName: candidate.modelName,
        }),
        providerOptions: providerOptions,
        experimental_transform: smoothStream({ chunking: "word" }),
        onStepEnd,
        onEnd: async (result) => {
          const usagePromise = saveUsageWithMetadata({
            result,
            usage: result.usage,
            userId,
            email: userEmail,
            emailAccountId,
            provider: candidate.provider,
            model: candidate.modelName,
            label,
            hasUserApiKey: modelOptions.hasUserApiKey,
          });

          const finishPromise = onEnd?.(result);

          try {
            await Promise.all([usagePromise, finishPromise]);
          } catch (error) {
            logger.error("onEnd 回调出错", {
              label,
              userEmail,
              error,
            });
            logger.trace("Result", { result });
            captureException(error, {
              userEmail,
              extra: { label },
            });
          }
        },
        onError: (error) => {
          logger.error("聊天补全流出错", {
            label,
            userEmail,
            error,
          });
          captureException(error, {
            userEmail,
            extra: { label },
          });
        },
      });
    } catch (error) {
      if (nextCandidate && shouldFallbackToNextModel(error)) {
        logger.warn("聊天补全失败，尝试备用模型", {
          label,
          provider: candidate.provider,
          model: candidate.modelName,
          fallbackProvider: nextCandidate.provider,
          fallbackModel: nextCandidate.modelName,
          error,
        });
        continue;
      }

      logger.error("聊天补全流出错", {
        label,
        userEmail,
        error,
      });
      captureException(error, {
        userEmail,
        extra: { label },
      });
      throw error;
    }
  }

  throw new Error("没有可用于聊天补全流的模型");
}

export async function toolCallAgentStream(options: ToolCallAgentStreamOptions) {
  const {
    messages,
    promptHardening,
    tools,
    activeTools,
    prepareStep,
    stopWhen,
    maxSteps,
    userId,
    emailAccountId,
    userEmail,
    usageLabel: label,
    providerOptions: requestProviderOptions,
    onEnd,
    onStepEnd,
    onModelResolved,
    sensitiveDataPolicy,
    temperature,
    abortSignal,
  } = options;
  const { modelOptions, modelCandidates } = await resolveModelCandidates({
    modelOptions: getModelOptionsForRoute(options),
    userEmail,
    userId,
    emailAccountId,
    label,
  });
  const hardenedMessages = applyPromptHardeningToMessages({
    messages,
    promptHardening,
  });
  const protectedMessages = enforceSensitiveDataPolicy({
    options: { messages: hardenedMessages },
    policy: sensitiveDataPolicy,
    logger,
    label,
    userId,
    emailAccountId,
  }).messages;

  for (let index = 0; index < modelCandidates.length; index++) {
    const candidate = modelCandidates[index];
    const nextCandidate = modelCandidates[index + 1];
    const providerOptions = buildProviderOptions({
      provider: candidate.provider,
      modelProviderOptions: candidate.providerOptions as
        | LLMProviderOptions
        | undefined,
      requestProviderOptions,
      userId,
      label,
      emailAccountId,
    });
    const candidateTools = wrapToolsWithSensitiveDataPolicy({
      tools: skipToolsAfterAbort(tools, abortSignal),
      policy: sensitiveDataPolicy,
      label,
      userId,
      emailAccountId,
    });
    const bridgedAgent = await bridgeClaudeCodeToolsIfNeeded({
      provider: candidate.provider,
      modelName: candidate.modelName,
      model: candidate.model,
      tools: candidateTools,
      activeTools,
    });
    onModelResolved?.({
      provider: candidate.provider,
      modelName: candidate.modelName,
      providerOptions,
    });

    const agent = new ToolLoopAgent({
      model: bridgedAgent.model,
      tools: bridgedAgent.tools,
      activeTools: bridgedAgent.bridged
        ? undefined
        : (activeTools as Array<keyof typeof candidateTools> | undefined),
      prepareStep,
      stopWhen: stopWhen ?? (maxSteps ? isStepCount(maxSteps) : undefined),
      temperature,
      ...commonOptions,
      telemetry: buildLlmTelemetry({
        userEmail,
        userId,
        emailAccountId,
        label,
        provider: candidate.provider,
        modelName: candidate.modelName,
      }),
      providerOptions,
      onEnd: async (result) => {
        const usagePromise = saveUsageWithMetadata({
          result,
          usage: result.usage,
          userId,
          email: userEmail,
          emailAccountId,
          provider: candidate.provider,
          model: candidate.modelName,
          label,
          hasUserApiKey: modelOptions.hasUserApiKey,
        });

        const finishPromise = onEnd?.(
          result as Parameters<
            NonNullable<StreamTextOnEndCallback<Record<string, Tool>>>
          >[0],
        );

        try {
          await Promise.all([usagePromise, finishPromise]);
        } catch (error) {
          logger.error("onEnd 回调出错", {
            label,
            userEmail,
            error,
          });
          logger.trace("Result", { result });
          captureException(error, {
            userEmail,
            extra: { label },
          });
        }
      },
    });

    try {
      return await agent.stream({
        messages: protectedMessages as ModelMessage[],
        experimental_transform: smoothStream({ chunking: "word" }),
        onStepEnd,
        abortSignal,
      });
    } catch (error) {
      if (nextCandidate && shouldFallbackToNextModel(error)) {
        logger.warn("工具调用流失败，尝试备用模型", {
          label,
          provider: candidate.provider,
          model: candidate.modelName,
          fallbackProvider: nextCandidate.provider,
          fallbackModel: nextCandidate.modelName,
          error,
        });
        continue;
      }

      logger.error("聊天补全流出错", {
        label,
        userEmail,
        error,
      });
      captureException(error, {
        userEmail,
        extra: { label },
      });
      throw error;
    }
  }

  throw new Error("没有可用于工具调用流的模型");
}

function getModelOptionsForRoute({
  userAi,
  modelType,
  useCase,
}: {
  userAi: UserAIFields;
} & ModelRouteSelection): SelectModel {
  if (modelType && useCase) {
    throw new Error("请提供 useCase 或 modelType 之一，不要同时提供两者");
  }

  return useCase
    ? getModelForUseCase(userAi, useCase)
    : getModel(userAi, modelType);
}

// 中止会结束流，但仍会运行模型已经发出的工具调用，
// 因此要在每次调用前检查，避免已停止的运行继续执行。
function skipToolsAfterAbort<TTools extends ToolSet | undefined>(
  tools: TTools,
  abortSignal: AbortSignal | undefined,
): TTools {
  if (!tools || !abortSignal) return tools;

  const guardedTools: ToolSet = { ...tools };

  for (const [toolName, toolDefinition] of Object.entries(guardedTools)) {
    const execute = toolDefinition.execute;
    if (!execute) continue;

    guardedTools[toolName] = {
      ...toolDefinition,
      execute(
        input: Parameters<NonNullable<typeof execute>>[0],
        options: Parameters<NonNullable<typeof execute>>[1],
      ) {
        abortSignal.throwIfAborted();
        return execute.call(toolDefinition, input, options);
      },
    } as ToolSet[string];
  }

  return guardedTools as TTools;
}

function wrapToolsWithSensitiveDataPolicy<TTools extends ToolSet | undefined>({
  tools,
  policy,
  label,
  userId,
  emailAccountId,
}: {
  tools: TTools;
  policy?: string | null;
  label: string;
  userId?: string;
  emailAccountId: string;
}): TTools {
  if (!tools || resolveSensitiveDataPolicy(policy) === "ALLOW") return tools;

  const protectedTools: ToolSet = { ...tools };

  for (const [toolName, toolDefinition] of Object.entries(protectedTools)) {
    const execute = toolDefinition.execute;
    if (!execute) continue;

    protectedTools[toolName] = {
      ...toolDefinition,
      execute(
        input: Parameters<NonNullable<typeof execute>>[0],
        options: Parameters<NonNullable<typeof execute>>[1],
      ) {
        const output = execute.call(toolDefinition, input, options);

        if (isAsyncIterable(output)) {
          return enforceSensitiveToolOutputStream({
            output,
            policy,
            label,
            toolName,
            userId,
            emailAccountId,
          });
        }

        return Promise.resolve(output).then((resolvedOutput) =>
          enforceSensitiveToolOutputPolicy({
            output: resolvedOutput,
            policy,
            logger,
            label: `${label}:${toolName}`,
            userId,
            emailAccountId,
          }),
        );
      },
    } as ToolSet[string];
  }

  return protectedTools as TTools;
}

async function* enforceSensitiveToolOutputStream({
  output,
  policy,
  label,
  toolName,
  userId,
  emailAccountId,
}: {
  output: AsyncIterable<unknown>;
  policy?: string | null;
  label: string;
  toolName: string;
  userId?: string;
  emailAccountId: string;
}) {
  for await (const item of output) {
    yield enforceSensitiveToolOutputPolicy({
      output: item,
      policy,
      logger,
      label: `${label}:${toolName}`,
      userId,
      emailAccountId,
    });
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" && value !== null && Symbol.asyncIterator in value
  );
}

async function handleError(
  error: unknown,
  userId: string,
  userEmail: string,
  emailAccountId: string,
  label: string,
  modelName: string,
  hasUserApiKey: boolean,
) {
  const apiError = getAIApiCallError(error);
  const isUserKeyInsufficientCredits =
    hasUserApiKey && !!apiError && isInsufficientCreditsError(apiError);

  if (isUserKeyInsufficientCredits) {
    logger.warn("用户 API 密钥额度不足", {
      userId,
      emailAccountId,
      label,
      modelName,
    });
  } else {
    logger.error("LLM 调用出错", {
      error,
      userId,
      userEmail,
      emailAccountId,
      label,
      modelName,
    });
  }

  const notifyUser = async (
    errorType: PersistedErrorType,
    errorMessage: string,
  ) => {
    if (hasUserApiKey) markAsHandledUserKeyError(error);
    await addUserErrorMessageWithNotification({
      userId,
      userEmail,
      emailAccountId,
      errorType,
      errorMessage,
      logger,
    });
  };

  if (APICallError.isInstance(error)) {
    if (isIncorrectAPIKeyError(error)) {
      return await notifyUser(
        ErrorType.INCORRECT_API_KEY,
        "你的 AI API 密钥无效。请在设置中更新它。",
      );
    }

    if (isInvalidAIModelError(error)) {
      await notifyUser(
        ErrorType.INVALID_AI_MODEL,
        "你指定的 AI 模型不存在或不可用。请检查你的设置。",
      );
      throw new SafeError(
        "你指定的 AI 模型不存在或不可用。请更新你的 AI 设置。",
      );
    }

    if (isAPIKeyDeactivatedError(error)) {
      return await notifyUser(
        ErrorType.API_KEY_DEACTIVATED,
        "你的 AI API 密钥已被停用。请在设置中更新它。",
      );
    }
  }

  // 余额耗尽可能以可重试的 429 形式出现，因此要透过重试查看底层错误。
  if (
    apiError &&
    (isAnthropicInsufficientBalanceError(apiError) ||
      (isInsufficientCreditsError(apiError) && hasUserApiKey))
  ) {
    return await notifyUser(
      ErrorType.INSUFFICIENT_CREDITS,
      "你的 AI 服务商账号额度不足。请充值或更新设置中的 API 密钥。",
    );
  }

  if (RetryError.isInstance(error) && isAiQuotaExceededError(error)) {
    return await addUserErrorMessageWithNotification({
      userId,
      userEmail,
      emailAccountId,
      errorType: ErrorType.AI_QUOTA_ERROR,
      errorMessage:
        "你的 AI 服务商因限流或配额拒绝了请求。如果问题持续，请检查你的服务商账号。",
      logger,
    });
  }
}

async function getCostControlledModelOptions({
  modelOptions,
  userEmail,
  userId,
  emailAccountId,
  label,
}: {
  modelOptions: SelectModel;
  userEmail: string;
  userId?: string;
  emailAccountId?: string;
  label: string;
}): Promise<SelectModel> {
  if (label === "assistant-chat") {
    return modelOptions;
  }

  const guard = await shouldForceNanoModel({
    userEmail,
    hasUserApiKey: modelOptions.hasUserApiKey,
    label,
    userId,
    emailAccountId,
  });

  if (!guard.shouldForce) {
    return modelOptions;
  }

  try {
    const nanoModelOptions = getModel(NO_USER_AI_FIELDS, "nano");
    const configuredNanoModel = getConfiguredRolePrimaryModel("nano");
    const isResolvedConfiguredNanoModel =
      !!configuredNanoModel &&
      nanoModelOptions.provider === configuredNanoModel.provider &&
      nanoModelOptions.modelName === configuredNanoModel.modelName;

    if (!isResolvedConfiguredNanoModel) {
      logger.warn("nano 用量守卫已触发，但 nano 模型不可用", {
        label,
        userId,
        emailAccountId,
        weeklySpendUsd: guard.weeklySpendUsd,
        weeklyLimitUsd: guard.weeklyLimitUsd,
        configuredProvider: configuredNanoModel?.provider,
        configuredModel: configuredNanoModel?.modelName,
        resolvedProvider: nanoModelOptions.provider,
        resolvedModel: nanoModelOptions.modelName,
      });
      return modelOptions;
    }

    if (
      nanoModelOptions.provider === modelOptions.provider &&
      nanoModelOptions.modelName === modelOptions.modelName
    ) {
      return modelOptions;
    }

    logger.info("由于每周 AI 支出，切换到 nano 模型", {
      label,
      userId,
      emailAccountId,
      weeklySpendUsd: guard.weeklySpendUsd,
      weeklyLimitUsd: guard.weeklyLimitUsd,
      previousProvider: modelOptions.provider,
      previousModel: modelOptions.modelName,
      nextProvider: nanoModelOptions.provider,
      nextModel: nanoModelOptions.modelName,
    });

    return nanoModelOptions;
  } catch (error) {
    logger.error("用量守卫期间解析 nano 模型失败", {
      label,
      userId,
      emailAccountId,
      error,
    });
    return modelOptions;
  }
}

async function resolveModelCandidates({
  modelOptions,
  userEmail,
  userId,
  emailAccountId,
  label,
}: {
  modelOptions: SelectModel;
  userEmail: string;
  userId?: string;
  emailAccountId?: string;
  label: string;
}): Promise<{
  modelOptions: SelectModel;
  modelCandidates: ResolvedModel[];
}> {
  await assertTrialAiUsageAllowed({
    userEmail,
    hasUserApiKey: modelOptions.hasUserApiKey,
    label,
    userId,
    emailAccountId,
  });

  const effectiveModelOptions = await getCostControlledModelOptions({
    modelOptions,
    userEmail,
    userId,
    emailAccountId,
    label,
  });

  return {
    modelOptions: effectiveModelOptions,
    modelCandidates: getModelCandidates(effectiveModelOptions),
  };
}

function getModelCandidates(modelOptions: SelectModel): ResolvedModel[] {
  const primaryModel: ResolvedModel = {
    provider: modelOptions.provider,
    modelName: modelOptions.modelName,
    model: modelOptions.model,
    providerOptions: modelOptions.providerOptions,
  };

  return [primaryModel, ...modelOptions.fallbackModels];
}

function getResolvedModelKey({ provider, modelName }: ResolvedModel): string {
  return `${provider}:${modelName}`;
}

function getLlmFallbackFailureCategory(
  error: unknown,
): LlmFallbackFailureCategory {
  if (isContentFilterRefusal(error)) return "content_filter";

  const errorInfo = extractLLMErrorInfo(error);
  if (
    errorInfo.isRateLimit ||
    (RetryError.isInstance(error) && isAiQuotaExceededError(error))
  ) {
    return "rate_limit";
  }
  if (isTransientNetworkError(error)) return "network";
  if (errorInfo.retryable) return "server_error";

  return "unknown";
}

function shouldFallbackToNextModel(error: unknown): boolean {
  const unwrappedError = (error as { error?: unknown })?.error ?? error;

  if (RetryError.isInstance(error) && isAiQuotaExceededError(error)) {
    return true;
  }

  if (isContentFilterRefusal(error)) return true;

  if (
    APICallError.isInstance(unwrappedError) &&
    isInvalidAIModelError(unwrappedError)
  ) {
    return true;
  }

  const llmErrorInfo = extractLLMErrorInfo(error);
  if (llmErrorInfo.retryable) return true;

  return isTransientNetworkError(error);
}

function buildSystemPromptCacheOverrides({
  protectedOptions,
  providerOptions,
  provider,
  cacheKey,
}: {
  protectedOptions: { instructions?: unknown; prompt?: unknown };
  providerOptions: LLMProviderOptions;
  provider: string;
  cacheKey: string;
}):
  | {
      messages: ModelMessage[];
      instructions: undefined;
      prompt: undefined;
      providerOptions: LLMProviderOptions;
    }
  | undefined {
  if (
    typeof protectedOptions.instructions !== "string" ||
    typeof protectedOptions.prompt !== "string"
  ) {
    return;
  }

  return {
    messages: buildCachedSystemMessages({
      system: protectedOptions.instructions,
      prompt: protectedOptions.prompt,
      provider,
    }),
    instructions: undefined,
    prompt: undefined,
    providerOptions: mergeProviderOptions(
      providerOptions,
      getSystemCacheProviderOptions(provider, { cacheKey }),
    ),
  };
}

function mergeProviderOptions(
  ...providerOptionsList: (LLMProviderOptions | undefined)[]
) {
  const merged: LLMProviderOptions = {};

  for (const options of providerOptionsList) {
    if (!options) continue;

    for (const [providerKey, value] of Object.entries(options)) {
      merged[providerKey] = {
        ...(merged[providerKey] || {}),
        ...value,
      };
    }
  }

  return merged;
}

function buildProviderOptions({
  provider,
  modelProviderOptions,
  requestProviderOptions,
  userId,
  label,
  emailAccountId,
}: {
  provider: string;
  modelProviderOptions?: LLMProviderOptions;
  requestProviderOptions?: LLMProviderOptions;
  userId?: string;
  label?: string;
  emailAccountId?: string;
}) {
  const mergedProviderOptions = mergeProviderOptions(
    commonOptions.providerOptions,
    modelProviderOptions,
    requestProviderOptions,
  );

  const withMetadata = withOpenRouterMetadata({
    provider,
    providerOptions: mergedProviderOptions,
    userId,
    label,
    emailAccountId,
  });

  return withMetadata;
}

function withOpenRouterMetadata({
  provider,
  providerOptions,
  userId,
  label,
  emailAccountId,
}: {
  provider: string;
  providerOptions: LLMProviderOptions;
  userId?: string;
  label?: string;
  emailAccountId?: string;
}) {
  if (provider !== Provider.OPENROUTER) return providerOptions;

  const openRouterOptions = providerOptions.openrouter || {};
  const nextOpenRouterOptions: Record<string, JSONValue> = {
    ...openRouterOptions,
  };

  let changed = false;

  if (
    userId &&
    !(typeof openRouterOptions.user === "string" && openRouterOptions.user)
  ) {
    nextOpenRouterOptions.user = userId;
    changed = true;
  }

  const openRouterTrace = isJsonObject(openRouterOptions.trace)
    ? openRouterOptions.trace
    : undefined;

  const nextTrace: Record<string, JSONValue> = {
    ...(openRouterTrace || {}),
  };
  let traceChanged = false;

  if (label && typeof nextTrace.trace_name !== "string") {
    nextTrace.trace_name = label;
    traceChanged = true;
  }

  if (label && typeof nextTrace.generation_name !== "string") {
    nextTrace.generation_name = label;
    traceChanged = true;
  }

  if (emailAccountId && typeof nextTrace.email_account_id !== "string") {
    nextTrace.email_account_id = emailAccountId;
    traceChanged = true;
  }

  if (traceChanged) {
    nextOpenRouterOptions.trace = nextTrace;
    changed = true;
  }

  if (!changed) return providerOptions;

  return {
    ...providerOptions,
    openrouter: nextOpenRouterOptions,
  };
}

function repairObjectText(text: string, label: string) {
  const attempt = createRepairAttemptState(text);
  let lastError: unknown;

  for (const candidate of getRepairCandidates(text)) {
    attempt.candidateKindsTried.push(candidate.kind);

    try {
      const repaired = jsonrepair(candidate.text);
      const normalized = normalizeRepairedObjectText(repaired);

      if (normalized) {
        attempt.successfulCandidateKind = candidate.kind;
        return { text: normalized.text, attempt };
      }
    } catch (error) {
      lastError = error;
    }
  }

  logger.warn("修复无效的 JSON 响应失败", {
    label,
    length: text.length,
    startsWithQuote: /^[\s]*['"`]/.test(text),
    startsWithBrace: /^[\s]*\{/.test(text),
    startsWithBracket: /^[\s]*\[/.test(text),
    error: lastError,
  });

  return { text, attempt };
}

function getRepairCandidates(text: string) {
  const trimmed = text.trim();
  const unwrapped = unwrapQuotedJson(trimmed);
  const extracted = extractBalancedJsonRegions(trimmed);

  return dedupeRepairCandidates([
    { kind: "unwrapped", text: unwrapped },
    ...extracted.map((region) => ({
      kind: "extracted" as const,
      text: region,
    })),
    { kind: "trimmed", text: trimmed },
    { kind: "original", text },
  ]);
}

function extractBalancedJsonRegions(text: string): string[] {
  const regions: string[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (ch === "{" || ch === "[") {
      const region = walkBalancedJsonFrom(text, i);
      if (region) {
        regions.push(region);
        i += region.length;
        continue;
      }
    }
    i++;
  }

  return regions.sort((a, b) => {
    if (a.length !== b.length) return b.length - a.length;
    if (a[0] === b[0]) return 0;
    return a[0] === "{" ? -1 : 1;
  });
}

function walkBalancedJsonFrom(
  text: string,
  openIdx: number,
): string | undefined {
  const openChar = text[openIdx];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let stringChar: string | undefined;
  let escaped = false;

  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inString) {
      if (ch === "\\") {
        escaped = true;
      } else if (ch === stringChar) {
        inString = false;
        stringChar = undefined;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === "{" || ch === "[") {
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        if (ch !== closeChar) return;
        return text.slice(openIdx, i + 1);
      }
    }
  }
}

function unwrapQuotedJson(text: string) {
  if (text.length < 2) return;

  const wrapChar = text[0];
  const supportedWrapChars = new Set(["'", '"', "`"]);

  if (!supportedWrapChars.has(wrapChar) || text.at(-1) !== wrapChar) return;

  const inner = text.slice(1, -1).trim();

  if (!inner.startsWith("{") && !inner.startsWith("[")) return;

  return inner;
}

function normalizeRepairedObjectText(
  text: string,
): { text: string; kind: RepairResultKind } | undefined {
  const trimmed = text.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return { text: trimmed, kind: "object-or-array" };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "string") return;

    const inner = parsed.trim();
    if (inner.startsWith("{") || inner.startsWith("[")) {
      return { text: inner, kind: "string-wrapped-object-or-array" };
    }
  } catch {
    return;
  }
}

function createRepairAttemptState(text: string): RepairAttemptState {
  return {
    inputLength: text.length,
    inputFingerprint: hash(text) || "",
    startsWithQuote: /^[\s]*['"`]/.test(text),
    startsWithBrace: /^[\s]*\{/.test(text),
    startsWithBracket: /^[\s]*\[/.test(text),
    looksCodeFenced: /^[\s]*```/.test(text),
    candidateKindsTried: [],
  };
}

function buildRepairMetadata({
  attempt,
  label,
  provider,
  model,
}: {
  attempt: RepairAttemptState | undefined;
  label: string;
  provider: string;
  model: string;
}): LlmRepairMetadata | undefined {
  if (!attempt) return;

  return {
    attempted: true,
    successful: Boolean(attempt.successfulCandidateKind),
    label,
    provider,
    model,
    ...attempt,
  };
}

function dedupeRepairCandidates(
  candidates: Array<{ kind: RepairCandidateKind; text: string | undefined }>,
): Array<{ kind: RepairCandidateKind; text: string }> {
  const seen = new Set<string>();

  return candidates.flatMap((candidate) => {
    if (!candidate.text || seen.has(candidate.text)) return [];

    seen.add(candidate.text);
    return [{ kind: candidate.kind, text: candidate.text }];
  });
}

function getUsageMetadata(result: unknown): UsageMetadata {
  const stepCount = getStepCount(result);
  const toolCallCount = getToolCallCount(result);
  const providerCost = getOpenRouterProviderCost(result);

  return {
    stepCount,
    toolCallCount,
    providerRequestIds: getProviderRequestIds(result),
    providerReportedCost: providerCost.providerReportedCost,
    providerUpstreamInferenceCost: providerCost.providerUpstreamInferenceCost,
    providerCostSource: providerCost.providerCostSource,
  };
}

async function saveUsageWithMetadata({
  result,
  usage,
  userId,
  email,
  emailAccountId,
  provider,
  model,
  label,
  hasUserApiKey,
}: {
  result: unknown;
  usage: Parameters<typeof saveAiUsage>[0]["usage"];
  userId?: string;
  email: string;
  emailAccountId: string;
  provider: string;
  model: string;
  label: string;
  hasUserApiKey: boolean;
}) {
  const usageMetadata = getUsageMetadata(result);

  await saveAiUsage({
    userId,
    email,
    emailAccountId,
    usage,
    provider,
    model,
    label,
    hasUserApiKey,
    providerReportedCost: usageMetadata.providerReportedCost,
    providerUpstreamInferenceCost: usageMetadata.providerUpstreamInferenceCost,
    providerCostSource: usageMetadata.providerCostSource,
    providerRequestIds: usageMetadata.providerRequestIds,
    stepCount: usageMetadata.stepCount,
    toolCallCount: usageMetadata.toolCallCount,
  });
}

function getProviderRequestIds(result: unknown): string[] | undefined {
  const requestIds = new Set<string>();

  for (const step of getObjectArrayProperty(result, "steps") ?? []) {
    addProviderRequestId(requestIds, step);
  }
  addProviderRequestId(requestIds, result);

  return requestIds.size > 0 ? [...requestIds] : undefined;
}

function addProviderRequestId(requestIds: Set<string>, result: unknown) {
  const response = getObjectProperty(result, "response");
  const id = getProperty(response, "id");

  if (typeof id === "string" && id) requestIds.add(id);
}

function getStepCount(result: unknown) {
  const steps = getObjectArrayProperty(result, "steps");
  if (!steps) return;

  return steps.length;
}

function getToolCallCount(result: unknown) {
  const steps = getObjectArrayProperty(result, "steps");
  if (!steps) {
    return getObjectArrayProperty(result, "toolCalls")?.length;
  }

  return steps.reduce((count, step) => {
    const toolCalls = getObjectArrayProperty(step, "toolCalls");
    return count + (toolCalls?.length ?? 0);
  }, 0);
}

function getOpenRouterProviderCost(result: unknown): {
  providerReportedCost?: number;
  providerUpstreamInferenceCost?: number;
  providerCostSource?: ProviderCostSource;
} {
  // SDK 顶层的 providerMetadata 只描述最后一步，因此
  // 对多步调用而言，逐步用量才是权威来源。
  const stepUsages = (getObjectArrayProperty(result, "steps") ?? [])
    .map(getOpenRouterUsage)
    .filter((usage) => usage !== null);

  if (stepUsages.length > 0) {
    return {
      providerReportedCost: sumDefined(stepUsages.map((usage) => usage.cost)),
      providerUpstreamInferenceCost: sumDefined(
        stepUsages.map((usage) => usage.upstreamInferenceCost),
      ),
      providerCostSource: "openrouter_step_usage_sum",
    };
  }

  const directUsage = getOpenRouterUsage(result);
  if (!directUsage) return {};

  return {
    providerReportedCost: directUsage.cost,
    providerUpstreamInferenceCost: directUsage.upstreamInferenceCost,
    providerCostSource: "openrouter_usage",
  };
}

function sumDefined(values: Array<number | undefined>) {
  const defined = values.filter((value) => value !== undefined);
  if (defined.length === 0) return;

  return defined.reduce((total, value) => total + value, 0);
}

function getOpenRouterUsage(value: unknown): {
  cost?: number;
  upstreamInferenceCost?: number;
} | null {
  const providerMetadata = getObjectProperty(value, "providerMetadata");
  const openRouterMetadata = getObjectProperty(providerMetadata, "openrouter");
  const usage = getObjectProperty(openRouterMetadata, "usage");
  const costDetails = getObjectProperty(usage, "cost_details");
  const cost = getFiniteNumber(getProperty(usage, "cost"));
  const upstreamInferenceCost = getFiniteNumber(
    getProperty(costDetails, "upstream_inference_cost"),
  );

  if (cost === undefined && upstreamInferenceCost === undefined) return null;

  return { cost, upstreamInferenceCost };
}

function getObjectArrayProperty(value: unknown, key: string) {
  const property = getProperty(value, key);
  if (!Array.isArray(property)) return;

  return property.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null,
  );
}

function getObjectProperty(value: unknown, key: string) {
  const property = getProperty(value, key);
  if (
    typeof property !== "object" ||
    property === null ||
    Array.isArray(property)
  ) {
    return;
  }

  return property as Record<string, unknown>;
}

function getProperty(value: unknown, key: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return;
  }

  const record = value as Record<string, unknown>;
  return record[key];
}

function getFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string" && value) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
}

function isJsonObject(
  value: JSONValue | undefined,
): value is Record<string, JSONValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildLlmTelemetry({
  userEmail,
  userId,
  emailAccountId,
  label,
  provider,
  modelName,
}: {
  userEmail: string;
  userId?: string;
  emailAccountId?: string;
  label: string;
  provider: string;
  modelName: string;
}) {
  const posthogClient = getPosthogLlmClient();
  if (!posthogClient) return commonOptions.telemetry;

  const llmEvalsEnabled = isPosthogLlmEvalApproved(userEmail);
  let capturedInput: unknown;

  return {
    ...commonOptions.telemetry,
    functionId: label,
    recordInputs: llmEvalsEnabled,
    recordOutputs: llmEvalsEnabled,
    integrations: {
      onStart(event: unknown) {
        capturedInput = getTelemetryPrompt(event);
      },
      onEnd(event: unknown) {
        return captureAiGeneration(posthogClient, {
          distinctId: userEmail,
          provider,
          model: modelName,
          input: capturedInput ?? null,
          output: getTelemetryOutput(event),
          usage: toPosthogTokenUsage(event),
          privacyMode: !llmEvalsEnabled,
          stopReason: getTelemetryFinishReason(event),
          properties: {
            label,
            $ai_span_name: label,
            provider,
            model: modelName,
            emailAccountId,
            llmEvalsEnabled,
            ...(userId ? { userId } : {}),
          },
          onError: (error) => {
            logger.error("捕获 PostHog AI 生成记录失败", {
              error,
              label,
            });
          },
        });
      },
    },
  };
}

function getTelemetryPrompt(event: unknown) {
  const messages = getProperty(event, "messages");
  const hasMessages = Array.isArray(messages) && messages.length > 0;
  const instructions =
    getProperty(event, "instructions") ?? getProperty(event, "system");
  const hasInstructions =
    typeof instructions === "string" && instructions.length > 0;
  const prompt = getProperty(event, "prompt");
  const hasPrompt = typeof prompt === "string" && prompt.length > 0;

  if (hasMessages && hasInstructions) {
    return { instructions, messages };
  }
  if (hasMessages) return messages;
  if (hasPrompt) return prompt;
  if (hasInstructions) return instructions;
  return null;
}

function getTelemetryOutput(event: unknown) {
  const object = getProperty(event, "object");
  if (object != null) return object;

  const text = getProperty(event, "text");
  const hasText = typeof text === "string" && text.length > 0;
  const toolCalls = getNonEmptyArrayProperty(event, "toolCalls");
  const toolResults = getNonEmptyArrayProperty(event, "toolResults");
  const content = getNonEmptyArrayProperty(event, "content");

  if (toolCalls || toolResults || content) {
    return {
      ...(hasText ? { text } : {}),
      ...(toolCalls ? { toolCalls } : {}),
      ...(toolResults ? { toolResults } : {}),
      ...(content ? { content } : {}),
    };
  }

  return hasText ? text : null;
}

function getNonEmptyArrayProperty(event: unknown, key: string) {
  const value = getProperty(event, key);
  if (!Array.isArray(value) || value.length === 0) return;
  return value;
}

function getTelemetryFinishReason(event: unknown) {
  const finishReason = getProperty(event, "finishReason");
  return typeof finishReason === "string" ? finishReason : undefined;
}

function toPosthogTokenUsage(event: unknown) {
  const usage = getObjectProperty(event, "usage");
  if (!usage) return;

  return {
    inputTokens: getFiniteNumber(getProperty(usage, "inputTokens")),
    outputTokens: getFiniteNumber(getProperty(usage, "outputTokens")),
    reasoningTokens: getFiniteNumber(
      getProperty(
        getObjectProperty(usage, "outputTokenDetails"),
        "reasoningTokens",
      ),
    ),
    cacheReadInputTokens: getFiniteNumber(
      getProperty(
        getObjectProperty(usage, "inputTokenDetails"),
        "cacheReadTokens",
      ),
    ),
  };
}
