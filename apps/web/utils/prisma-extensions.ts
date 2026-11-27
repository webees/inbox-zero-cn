import { Prisma } from "@/generated/prisma/client";
import { decryptToken, encryptToken } from "@/utils/encryption";

/**
 * 静态透明加密的字段。要添加新字段：
 *   1. 在此处以 Prisma 模型名（camelCase）添加。
 *   2. 如果该字段在数据库中已有明文值，则无需其他操作：
 *      读取会原样透传明文，直到该行下次写入。
 *      可选：运行回填以重新保存这些值，使其采用带版本的密文格式。
 *
 * 不要添加按值查询的字段（例如 Session.sessionToken、EmailToken.token）：
 * 随机 IV 加密会破坏 WHERE 查找。
 */
const ENCRYPTED_FIELDS = {
  account: ["access_token", "refresh_token"],
  calendarConnection: ["accessToken", "refreshToken"],
  driveConnection: ["accessToken", "refreshToken"],
  messagingChannel: ["accessToken", "refreshToken"],
  mcpConnection: ["accessToken", "refreshToken", "apiKey"],
  mcpIntegration: ["oauthClientSecret"],
  // 原始加入链接携带 Zoom 和 Teams 的会议密码。去重查询使用
  // normalizedMeetingUrl 和 activeKey，绝不使用该字段，
  // 因此加密它不会破坏任何查找。
  meetingRecording: ["meetingUrl"],
  user: ["aiApiKey", "webhookSecret"],
} as const satisfies Record<string, readonly string[]>;

type FieldSpec = Record<string, readonly string[]>;
type MutableData = Record<string, unknown> | undefined | null;

export const encryptedTokens = Prisma.defineExtension((client) =>
  client.$extends({
    result: buildResult(ENCRYPTED_FIELDS) as never,
    query: buildQuery(ENCRYPTED_FIELDS) as never,
  }),
);

function buildResult(spec: FieldSpec) {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [model, fields] of Object.entries(spec)) {
    const modelResult: Record<string, unknown> = {};
    for (const field of fields) {
      modelResult[field] = {
        needs: { [field]: true },
        compute(row: Record<string, string | null>) {
          return decryptToken(row[field]);
        },
      };
    }
    result[model] = modelResult;
  }
  return result;
}

export const __testing__ = {
  buildQuery,
  encryptCreateData,
  encryptUpdateData,
};

function buildQuery(spec: FieldSpec) {
  const query: Record<string, Record<string, unknown>> = {};
  for (const [model, fields] of Object.entries(spec)) {
    query[model] = {
      async create({ args, query }: QueryArgs<"create">) {
        encryptCreateData(args.data, fields);
        return query(args);
      },
      async update({ args, query }: QueryArgs<"update">) {
        encryptUpdateData(args.data, fields);
        return query(args);
      },
      async updateMany({ args, query }: QueryArgs<"updateMany">) {
        encryptUpdateData(args.data, fields);
        return query(args);
      },
      async upsert({ args, query }: QueryArgs<"upsert">) {
        encryptCreateData(args.create, fields);
        encryptUpdateData(args.update, fields);
        return query(args);
      },
    };
  }
  return query;
}

function encryptCreateData(data: MutableData, fields: readonly string[]) {
  if (!data) return;
  for (const field of fields) {
    const value = data[field];
    if (typeof value === "string") data[field] = encryptToken(value);
  }
}

function encryptUpdateData(data: MutableData, fields: readonly string[]) {
  if (!data) return;
  for (const field of fields) {
    const value = data[field];
    if (typeof value === "string") {
      data[field] = encryptToken(value);
    } else if (isSetWrapper(value) && typeof value.set === "string") {
      value.set = encryptToken(value.set);
    }
  }
}

function isSetWrapper(value: unknown): value is { set: unknown } {
  return typeof value === "object" && value !== null && "set" in value;
}

type QueryArgs<Op extends "create" | "update" | "updateMany" | "upsert"> = {
  args: Op extends "upsert"
    ? { create: MutableData; update: MutableData }
    : { data: MutableData };
  query: (args: unknown) => Promise<unknown>;
};
