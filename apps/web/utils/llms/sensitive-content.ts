import type { Logger } from "@/utils/logger";
import { SafeError } from "@/utils/error";
import {
  redactSensitiveContent,
  scanSensitiveContent,
  type SensitiveContentFinding,
} from "@/utils/dlp/sensitive-content";
import { resolveSensitiveDataPolicy } from "@/utils/dlp/policy.server";

type LlmSensitiveDataOptions = {
  emailAccountId?: string;
  label: string;
  logger: Logger;
  policy?: string | null;
  userId?: string;
};

type LlmRequestOptions = {
  messages?: unknown;
  prompt?: unknown;
  instructions?: unknown;
};

const BLOCKED_TOOL_OUTPUT = {
  error: "检测到敏感内容，因此该工具结果已被你的账号设置阻止。",
  blocked: true,
} as const;

export function enforceSensitiveDataPolicy<T extends LlmRequestOptions>({
  options,
  emailAccountId,
  label,
  logger,
  policy,
  userId,
}: LlmSensitiveDataOptions & { options: T }): T {
  return enforceSensitiveDataPolicyOnValue({
    value: options,
    emailAccountId,
    label,
    logger,
    policy,
    userId,
    getFindings: getLlmRequestSensitiveContentFindings,
  });
}

export function enforceSensitiveToolOutputPolicy<T>({
  output,
  emailAccountId,
  label,
  logger,
  policy,
  userId,
}: LlmSensitiveDataOptions & { output: T }): T {
  return enforceSensitiveDataPolicyOnValue({
    value: output,
    emailAccountId,
    label,
    logger,
    policy,
    userId,
    blockReplacement: BLOCKED_TOOL_OUTPUT,
  });
}

function enforceSensitiveDataPolicyOnValue<T>({
  value,
  emailAccountId,
  label,
  logger,
  policy,
  userId,
  blockReplacement,
  getFindings = getSensitiveContentFindings,
}: LlmSensitiveDataOptions & {
  blockReplacement?: unknown;
  getFindings?: (value: T) => SensitiveContentFinding[];
  value: T;
}): T {
  const parsedPolicy = resolveSensitiveDataPolicy(policy);
  if (parsedPolicy === "ALLOW") return value;

  const findings = getFindings(value);
  if (findings.length === 0) return value;

  const summary = summarizeFindings(findings);
  logger.warn("在 AI 内容中检测到敏感内容", {
    emailAccountId,
    userId,
    label,
    policy: parsedPolicy,
    ...summary,
  });

  if (parsedPolicy === "BLOCK") {
    if (blockReplacement !== undefined) return blockReplacement as T;

    throw new SafeError("检测到敏感内容，因此该 AI 请求已被你的账号设置阻止。");
  }

  if (parsedPolicy === "REDACT") {
    return redactUnknown(value) as T;
  }

  return value;
}

export function redactSensitiveContentForLogging(text: string | undefined) {
  return text ? redactSensitiveContent(text) : undefined;
}

function getSensitiveContentFindings(value: unknown) {
  const strings = collectStrings(value);
  return strings.flatMap((text) => scanSensitiveContent(text));
}

function getLlmRequestSensitiveContentFindings(options: LlmRequestOptions) {
  const strings = [
    ...collectStrings(options.instructions),
    ...collectStrings(options.prompt),
    ...collectStrings(options.messages),
  ];

  return strings.flatMap((text) => scanSensitiveContent(text));
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    const redacted = redactSensitiveContent(value);
    return redacted === value ? value : redacted;
  }

  if (Array.isArray(value)) {
    let changed = false;
    const nextValue = value.map((item) => {
      const nextItem = redactUnknown(item);
      if (nextItem !== item) changed = true;
      return nextItem;
    });

    return changed ? nextValue : value;
  }

  if (isRecord(value)) {
    let changed = false;
    const nextValue: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value)) {
      const nextKey = redactSensitiveContent(key);
      if (nextKey !== key) changed = true;

      const nextItem = redactUnknown(item);
      if (nextItem !== item) changed = true;
      nextValue[nextKey] = nextItem;
    }

    return changed ? nextValue : value;
  }

  return value;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStrings(item));
  }

  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, item]) => [
      key,
      ...collectStrings(item),
    ]);
  }

  return [];
}

function summarizeFindings(findings: SensitiveContentFinding[]): {
  categories: SensitiveContentFinding["category"][];
  findingCount: number;
  labels: string[];
} {
  return {
    categories: uniqueSorted(findings.map((finding) => finding.category)),
    findingCount: findings.length,
    labels: uniqueSorted(findings.map((finding) => finding.label)),
  };
}

function uniqueSorted<T extends string>(values: T[]) {
  return Array.from(new Set(values)).sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
