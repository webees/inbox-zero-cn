import { SafeError } from "@/utils/error";
import { isDuplicateError } from "@/utils/prisma-helpers";
import type {
  UpdateMailSplitBody,
  DeleteMailSplitBody,
} from "@/utils/actions/mail-split.validation";
import { randomUUID } from "node:crypto";
import type { MailSplit } from "@/generated/prisma/client";
import { MailSplitFilterKind } from "@/generated/prisma/enums";
import type { MailSplitFilterDraft } from "@/utils/split-inbox/split-filters";
import prisma from "@/utils/prisma";
import { lockMailSplits } from "@/utils/split-inbox/split-lock";
import { MAX_MAIL_SPLITS } from "@/utils/split-inbox/split-constants";

type CreateMailSplitResult =
  | ({ status: "created" } & MailSplit)
  | { status: "duplicate" | "limit" };

export async function createMailSplit({
  emailAccountId,
  name,
  matchAll,
  filters,
}: {
  emailAccountId: string;
  name: string;
  matchAll: boolean;
  filters: MailSplitFilterDraft[];
}) {
  // id 预先选定，这样分类及其条件可以在
  // 一个事务中写入，中间无需往返。
  const splitId = randomUUID();

  const [, results] = await prisma.$transaction([
    lockMailSplits(emailAccountId),
    prisma.$queryRaw<CreateMailSplitResult[]>`
      WITH split_state AS (
        SELECT
          COUNT(*)::integer AS count,
          COALESCE(MAX("order"), -1)::integer + 1 AS next_order,
          EXISTS (
            SELECT 1
            FROM "MailSplit"
            WHERE "emailAccountId" = ${emailAccountId}
              AND "name" = ${name}
          ) AS name_exists
        FROM "MailSplit"
        WHERE "emailAccountId" = ${emailAccountId}
      ),
      inserted AS (
        INSERT INTO "MailSplit" (
          "id",
          "createdAt",
          "updatedAt",
          "name",
          "matchAll",
          "order",
          "emailAccountId"
        )
        SELECT
          ${splitId},
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP,
          ${name},
          ${matchAll},
          split_state.next_order,
          ${emailAccountId}
        FROM split_state
        WHERE split_state.count < ${MAX_MAIL_SPLITS}
          AND NOT split_state.name_exists
        RETURNING *
      )
      SELECT
        CASE
          WHEN inserted."id" IS NOT NULL THEN 'created'
          WHEN split_state.name_exists THEN 'duplicate'
          ELSE 'limit'
        END AS status,
        inserted.*
      FROM split_state
      LEFT JOIN inserted ON TRUE
    `,
    // 以分类存在为前提，因此上面被拒绝的插入（达到上限、
    // 名称重复）不会让条件指向不存在的内容。
    prisma.$executeRaw`
      INSERT INTO "MailSplitFilter" ("id", "kind", "value", "order", "mailSplitId")
      SELECT
        conditions."id",
        conditions."kind"::"MailSplitFilterKind",
        conditions."value",
        conditions."order",
        ${splitId}
      FROM jsonb_to_recordset(${toFilterRows(filters)}::jsonb)
        AS conditions("id" text, "kind" text, "value" text, "order" integer)
      WHERE EXISTS (SELECT 1 FROM "MailSplit" WHERE "id" = ${splitId})
    `,
  ]);

  return results[0];
}

export function toFilterRows(filters: MailSplitFilterDraft[]) {
  return JSON.stringify(
    filters.map((filter, order) => ({
      id: randomUUID(),
      kind: filter.kind,
      value: filter.value ?? null,
      order,
    })),
  );
}

export async function removeLabelFromMailSplits({
  emailAccountId,
  labelId,
}: {
  emailAccountId: string;
  labelId: string;
}) {
  await prisma.$transaction([
    lockMailSplits(emailAccountId),
    prisma.mailSplit.deleteMany({
      where: {
        emailAccountId,
        filters: {
          some: {},
          every: { kind: MailSplitFilterKind.LABEL, value: labelId },
        },
      },
    }),
    prisma.mailSplit.updateMany({
      where: {
        emailAccountId,
        filters: { some: { kind: MailSplitFilterKind.LABEL, value: labelId } },
      },
      data: { updatedAt: new Date() },
    }),
    prisma.mailSplitFilter.deleteMany({
      where: {
        kind: MailSplitFilterKind.LABEL,
        value: labelId,
        mailSplit: { emailAccountId },
      },
    }),
  ]);
}

/** 仅重排选中的位置，以便隐藏的分类保持其位置。 */
export async function reorderMailSplits({
  emailAccountId,
  ids,
}: {
  emailAccountId: string;
  ids: string[];
}) {
  await prisma.$transaction([
    lockMailSplits(emailAccountId),
    prisma.$executeRaw`
      WITH selected AS (
        SELECT "id", "order", "createdAt"
        FROM "MailSplit"
        WHERE "emailAccountId" = ${emailAccountId}
          AND "id" = ANY(${ids}::text[])
      ),
      positions AS (
        SELECT "order", ROW_NUMBER() OVER (ORDER BY "order", "createdAt", "id") AS slot
        FROM selected
      ),
      reordered AS (
        SELECT "id", ROW_NUMBER() OVER (ORDER BY array_position(${ids}::text[], "id")) AS slot
        FROM selected
      )
      UPDATE "MailSplit" split
      SET "order" = positions."order", "updatedAt" = CURRENT_TIMESTAMP
      FROM reordered JOIN positions USING (slot)
      WHERE split."id" = reordered."id"
    `,
  ]);
}

export async function createMailSplitOrThrow({
  emailAccountId,
  name,
  matchAll,
  filters,
}: {
  emailAccountId: string;
  name: string;
  matchAll: boolean;
  filters: MailSplitFilterDraft[];
}): Promise<MailSplit> {
  try {
    const result = await createMailSplit({
      emailAccountId,
      name,
      matchAll,
      filters,
    });

    if (!result) {
      throw new SafeError("无法创建分类，请重试");
    }
    if (result.status !== "created") {
      if (result.status === "duplicate") {
        throw new SafeError(`你已经有一个名为 "${name}" 的分类`);
      }
      throw new SafeError(`你最多只能有 ${MAX_MAIL_SPLITS} 个分类`);
    }

    const { status: _, ...split } = result;
    return split;
  } catch (error) {
    if (isDuplicateError(error, "name")) {
      throw new SafeError(`你已经有一个名为 "${name}" 的分类`);
    }
    throw error;
  }
}

export async function updateMailSplit({
  emailAccountId,
  id,
  name,
  filters,
  matchAll,
}: UpdateMailSplitBody & { emailAccountId: string }) {
  try {
    // 使用一个事务，这样分类绝不会出现已重命名但仍
    // 携带旧条件的情况。筛选器是整体替换而非
    // 做差异比较：构建器会返回它正在显示的条件，因此
    // 该列表中缺少的任何内容都已被移除。
    const [, { count }] = await prisma.$transaction([
      lockMailSplits(emailAccountId),
      prisma.mailSplit.updateMany({
        where: { id, emailAccountId },
        data: { name, matchAll },
      }),
      // 通过分类的所有者限定范围，因此另一个账号的 id
      // 即使 `id` 由调用方提供，也无法触达这些行。
      prisma.mailSplitFilter.deleteMany({
        where: { mailSplitId: id, mailSplit: { emailAccountId } },
      }),
      prisma.$executeRaw`
            INSERT INTO "MailSplitFilter" ("id", "kind", "value", "order", "mailSplitId")
            SELECT
              conditions."id",
              conditions."kind"::"MailSplitFilterKind",
              conditions."value",
              conditions."order",
              ${id}
            FROM jsonb_to_recordset(${toFilterRows(filters)}::jsonb)
              AS conditions("id" text, "kind" text, "value" text, "order" integer)
            WHERE EXISTS (
              SELECT 1 FROM "MailSplit"
              WHERE "id" = ${id} AND "emailAccountId" = ${emailAccountId}
            )
          `,
    ]);
    if (!count) throw new SafeError("未找到分类");
  } catch (error) {
    if (isDuplicateError(error, "name")) {
      throw new SafeError(`你已经有一个名为 "${name}" 的分类`);
    }
    throw error;
  }
}

export async function deleteMailSplit({
  emailAccountId,
  id,
}: DeleteMailSplitBody & { emailAccountId: string }) {
  // 使用 deleteMany 而非 delete，这样另一个账号的 id 永远不会被删除
  const [, { count }] = await prisma.$transaction([
    lockMailSplits(emailAccountId),
    prisma.mailSplit.deleteMany({
      where: { id, emailAccountId, filters: { some: {} } },
    }),
  ]);
  if (!count) throw new SafeError("Split not found or cannot be removed");
}
