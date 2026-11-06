import { NextResponse } from "next/server";
import { z } from "zod";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import {
  statsByPeriodQuerySchema,
  statsByPeriodResponseSchema,
} from "@/app/api/v1/stats/by-period/validation";
import {
  responseTimeQuerySchema,
  responseTimeResponseSchema,
} from "@/app/api/v1/stats/response-time/validation";
import {
  rulePathParamsSchema,
  ruleRequestBodySchema,
  ruleResponseSchema,
  rulesResponseSchema,
} from "@/app/api/v1/rules/validation";
import {
  unsubscribeSenderRequestSchema,
  unsubscribeSenderResponseSchema,
} from "@/app/api/v1/senders/unsubscribe/validation";
import { API_KEY_HEADER } from "@/utils/api-auth";
import {
  API_KEY_SCOPE_OPTIONS,
  type ApiKeyScopeValue,
} from "@/utils/api-key-scopes";
import { env } from "@/env";
import { BRAND_NAME } from "@/utils/branding";
import {
  PUBLIC_API_DOCS_URL,
  PUBLIC_API_OPENAPI_PATH,
  createPublicApiErrorBody,
} from "@/utils/public-api-error";

extendZodWithOpenApi(z);

const publicApiErrorSchema = z
  .object({
    error: z.object({
      code: z.enum([
        "BAD_REQUEST",
        "UNAUTHORIZED",
        "FORBIDDEN",
        "NOT_FOUND",
        "METHOD_NOT_ALLOWED",
        "RATE_LIMITED",
        "INTERNAL_ERROR",
      ]),
      message: z.string(),
      hint: z.string(),
    }),
  })
  .openapi("PublicApiError");

const API_KEY_SCOPE_DESCRIPTIONS = Object.fromEntries(
  API_KEY_SCOPE_OPTIONS.map((scope) => [scope.value, scope.description]),
) as Record<(typeof API_KEY_SCOPE_OPTIONS)[number]["value"], string>;

export function createPublicOpenApiDocument() {
  const registry = createRegistry();
  const generator = new OpenApiGeneratorV31(registry.definitions);

  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: `${BRAND_NAME} API`,
      version: "1.0.0",
      description: [
        `以编程方式访问 ${BRAND_NAME} 收件箱统计、自动化规则和发件人退订。`,
        `文档：${PUBLIC_API_DOCS_URL}`,
        `机器可读 schema：${PUBLIC_API_OPENAPI_PATH}`,
        "使用账号级 API 密钥通过 API-Key 请求头进行认证。",
        "错误会返回包含 error.code、error.message 和 error.hint 的 JSON。",
      ].join(" "),
    },
    servers: [
      {
        url: `${env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, "")}/api/v1`,
        description: "主服务器",
      },
    ],
    security: [{ ApiKeyAuth: [] }],
  });
}

export function getPublicOpenApiResponse(options?: { contentType?: string }) {
  if (!env.NEXT_PUBLIC_EXTERNAL_API_ENABLED) {
    return NextResponse.json(
      createPublicApiErrorBody({
        code: "NOT_FOUND",
        message: "外部 API 未启用",
        hint: "启用 NEXT_PUBLIC_EXTERNAL_API_ENABLED 以公开公共 API schema。",
      }),
      { status: 404 },
    );
  }

  const docs = createPublicOpenApiDocument();

  return new NextResponse(JSON.stringify(docs), {
    headers: {
      "Content-Type":
        options?.contentType ?? "application/vnd.oai.openapi+json;version=3.1",
      "Cache-Control": "public, max-age=300",
    },
  });
}

function createRegistry() {
  const registry = new OpenAPIRegistry();

  registry.registerComponent("securitySchemes", "ApiKeyAuth", {
    type: "apiKey",
    in: "header",
    name: API_KEY_HEADER,
    description: [
      "在设置中创建的账号级 API 密钥。",
      "各操作会声明其所需的权限范围。",
      "可用范围：",
      ...Object.entries(API_KEY_SCOPE_DESCRIPTIONS).map(
        ([scope, description]) => `- ${scope}: ${description}`,
      ),
    ].join("\n"),
    "x-scopes": API_KEY_SCOPE_DESCRIPTIONS,
  });

  registry.registerPath({
    method: "get",
    path: "/stats/by-period",
    operationId: "getStatsByPeriod",
    description:
      "获取按时间段分组的邮件统计。返回每个时间段内按状态（全部、已发送、已读、未读、已归档、未归档）统计的邮件数量。",
    security: apiKeySecurity(["STATS_READ"]),
    "x-required-scopes": ["STATS_READ"],
    request: {
      query: statsByPeriodQuerySchema,
    },
    responses: {
      200: {
        description: "成功响应",
        content: {
          "application/json": {
            schema: statsByPeriodResponseSchema,
          },
        },
      },
      ...errorResponses([400, 401, 403, 405, 429, 500]),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/stats/response-time",
    operationId: "getStatsResponseTime",
    description:
      "获取邮件回复时间统计。返回摘要统计、分布和趋势数据，展示你回复邮件的速度。",
    security: apiKeySecurity(["STATS_READ"]),
    "x-required-scopes": ["STATS_READ"],
    request: {
      query: responseTimeQuerySchema,
    },
    responses: {
      200: {
        description: "成功响应",
        content: {
          "application/json": {
            schema: responseTimeResponseSchema,
          },
        },
      },
      ...errorResponses([400, 401, 403, 405, 429, 500]),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/rules",
    operationId: "listRules",
    description: "列出指定收件箱账号的自动化规则。",
    security: apiKeySecurity(["RULES_READ"]),
    "x-required-scopes": ["RULES_READ"],
    responses: {
      200: {
        description: "成功响应",
        content: {
          "application/json": {
            schema: rulesResponseSchema,
          },
        },
      },
      ...errorResponses([401, 403, 405, 429, 500]),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/rules",
    operationId: "createRule",
    description: "为指定收件箱账号创建一条自动化规则。",
    security: apiKeySecurity(["RULES_WRITE"]),
    "x-required-scopes": ["RULES_WRITE"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: ruleRequestBodySchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: "成功响应",
        content: {
          "application/json": {
            schema: ruleResponseSchema,
          },
        },
      },
      ...errorResponses([400, 401, 403, 405, 429, 500]),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/rules/{id}",
    operationId: "getRule",
    description: "获取指定收件箱账号的某条自动化规则。",
    security: apiKeySecurity(["RULES_READ"]),
    "x-required-scopes": ["RULES_READ"],
    request: {
      params: rulePathParamsSchema,
    },
    responses: {
      200: {
        description: "成功响应",
        content: {
          "application/json": {
            schema: ruleResponseSchema,
          },
        },
      },
      ...errorResponses([400, 401, 403, 404, 405, 429, 500]),
    },
  });

  registry.registerPath({
    method: "put",
    path: "/rules/{id}",
    operationId: "replaceRule",
    description: "替换指定收件箱账号的一条自动化规则。",
    security: apiKeySecurity(["RULES_WRITE"]),
    "x-required-scopes": ["RULES_WRITE"],
    request: {
      params: rulePathParamsSchema,
      body: {
        content: {
          "application/json": {
            schema: ruleRequestBodySchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "成功响应",
        content: {
          "application/json": {
            schema: ruleResponseSchema,
          },
        },
      },
      ...errorResponses([400, 401, 403, 404, 405, 429, 500]),
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/rules/{id}",
    operationId: "deleteRule",
    description: "删除指定收件箱账号的一条自动化规则。",
    security: apiKeySecurity(["RULES_WRITE"]),
    "x-required-scopes": ["RULES_WRITE"],
    request: {
      params: rulePathParamsSchema,
    },
    responses: {
      204: {
        description: "规则已删除",
      },
      ...errorResponses([400, 401, 403, 404, 405, 429, 500]),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/senders/unsubscribe",
    operationId: "unsubscribeSender",
    description:
      "为指定收件箱的某个发件人退订。未提供链接时，会从该发件人的邮件中查找 List-Unsubscribe。请检查 unsubscribe.success：当其为 false 时，该发件人未被更改。",
    security: apiKeySecurity(["SENDERS_UNSUBSCRIBE"]),
    "x-required-scopes": ["SENDERS_UNSUBSCRIBE"],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: unsubscribeSenderRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "退订尝试已完成",
        content: {
          "application/json": {
            schema: unsubscribeSenderResponseSchema,
          },
        },
      },
      ...errorResponses([400, 401, 403, 405, 429, 500]),
    },
  });

  return registry;
}

function errorResponses(
  statuses: Array<400 | 401 | 403 | 404 | 405 | 429 | 500>,
): Record<
  number,
  {
    description: string;
    content: {
      "application/json": {
        schema: typeof publicApiErrorSchema;
      };
    };
  }
> {
  const descriptions: Record<number, string> = {
    400: "Invalid query, path, or request body",
    401: "Missing, invalid, or expired API key",
    403: "API key lacks a required scope or is not account-scoped",
    404: "Resource or route not found",
    405: "HTTP method is not supported for this route",
    429: "Rate limited by the API or email provider",
    500: "Unexpected server error",
  };

  return Object.fromEntries(
    statuses.map((status) => [
      status,
      {
        description: descriptions[status],
        content: {
          "application/json": {
            schema: publicApiErrorSchema,
          },
        },
      },
    ]),
  );
}

function apiKeySecurity(scopes: ApiKeyScopeValue[]) {
  return [{ ApiKeyAuth: scopes }];
}
