import { SafeError } from "@/utils/error";
import { isDuplicateError } from "@/utils/prisma-helpers";
import type {
  UpdateMailSplitBody,
  DeleteMailSplitBody,
} from "@/utils/actions/mail-split.validation";
import { randomUUID } from "node:crypto";
import type { MailSplit } from "@/generated/prisma/client";
import { MailSplitFilterKind } from "@/generated/prisma/enums";
import {
  MAX_SPLIT_FILTERS,
  type MailSplitFilterDraft,
} from "@/utils/split-inbox/split-filters";
import prisma from "@/utils/prisma";
import { lockMailSplits } from "@/utils/split-inbox/split-lock";
import { MAX_MAIL_SPLITS } from "@/utils/split-inbox/split-constants";
import { addSendersToSplitFilters } from "@/utils/split-inbox/split-senders";

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
  // 提前选定 id，这样拆分及其条件可以在一次事务中写入，中间无需往返查询。
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
    // 以拆分存在为前置条件，因此上方被拒绝的插入（达到上限或名称重复）不会留下指向空的
    // 条件。
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

/** 仅重排选中的位置，使隐藏的拆分保持原位。 */
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
      throw new SafeError("无法创建拆分，请重试。");
    }
    if (result.status !== "created") {
      if (result.status === "duplicate") {
        throw new SafeError(`你已有名为“${name}”的拆分。`);
      }
      throw new SafeError(`最多只能有 ${MAX_MAIL_SPLITS} 个拆分。`);
    }

    const { status: _, ...split } = result;
    return split;
  } catch (error) {
    if (isDuplicateError(error, "name")) {
      throw new SafeError(`你已有名为“${name}”的拆分。`);
    }
    throw error;
  }
}

export async function addSendersToMailSplit({
  emailAccountId,
  id,
  senders,
}: {
  emailAccountId: string;
  id: string;
  senders: string[];
}) {
  const result = await planSenderAdditions({ emailAccountId, id, senders });
  if (!result.added.length) return { added: 0 };

  // 在账号锁内追加，而不是替换上方读取的列表，因此其间发生的编辑（构建器保存、另一次添加）
  // 不会被撤销。重复和上限检查会针对已锁定的行重新执行。
  const rows = toFilterRows(
    result.added.map((value) => ({ kind: MailSplitFilterKind.FROM, value })),
  );
  const addedIds = (JSON.parse(rows) as { id: string }[]).map((row) => row.id);
  const [, added] = await prisma.$transaction([
    lockMailSplits(emailAccountId),
    prisma.$executeRaw`
      WITH split_state AS (
        SELECT COUNT(*)::integer AS count, COALESCE(MAX("order"), -1)::integer + 1 AS next_order
        FROM "MailSplitFilter" WHERE "mailSplitId" = ${id}
      ), additions AS (
        SELECT additions.*
        FROM jsonb_to_recordset(${rows}::jsonb)
          AS additions("id" text, "kind" text, "value" text, "order" integer)
        WHERE NOT EXISTS (
          SELECT 1 FROM "MailSplitFilter" existing
          WHERE existing."mailSplitId" = ${id}
            AND existing."kind" = 'FROM'
            AND (
              lower(existing."value") = additions."value"
              -- 与 matchesSenderFilter 保持一致：其中的“@domain”覆盖该域下的所有地址。
              OR (
                left(existing."value", 1) = '@'
                AND right(additions."value", length(existing."value")) = lower(existing."value")
              )
            )
        )
      )
      INSERT INTO "MailSplitFilter" ("id", "kind", "value", "order", "mailSplitId")
      SELECT additions."id", 'FROM'::"MailSplitFilterKind", additions."value",
        split_state.next_order + ROW_NUMBER() OVER (ORDER BY additions."order") - 1, ${id}
      FROM additions CROSS JOIN split_state
      WHERE EXISTS (
          -- 针对已锁定的行与 canAddSendersToSplit 保持一致，因此自上方读取以来，
          -- 若拆分被改为多个条件的“匹配全部”，不会被放宽为“匹配任意”。
          SELECT 1 FROM "MailSplit" split
          WHERE split."id" = ${id} AND split."emailAccountId" = ${emailAccountId}
            AND split_state.count > 0
            AND (
              NOT split."matchAll"
              OR split_state.count = 1
              OR NOT EXISTS (
                SELECT 1 FROM "MailSplitFilter" other
                WHERE other."mailSplitId" = ${id} AND other."kind" <> 'FROM'
              )
            )
        )
        AND split_state.count + (SELECT COUNT(*) FROM additions) <= ${MAX_SPLIT_FILTERS}
    `,
    // “匹配全部”下的多个条件将匹配不到任何邮件。仅在本次请求添加了发件人时适用，
    // 因此跳过的插入不会改变任何内容。
    prisma.$executeRaw`
      UPDATE "MailSplit"
      SET "matchAll" = false, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${id}
        AND "emailAccountId" = ${emailAccountId}
        AND EXISTS (
          SELECT 1 FROM "MailSplitFilter"
          WHERE "mailSplitId" = ${id} AND "id" = ANY(${addedIds}::text[])
        )
        AND (SELECT COUNT(*) FROM "MailSplitFilter" WHERE "mailSplitId" = ${id}) > 1
    `,
  ]);

  // 已锁定的检查跳过了所有内容：基于拆分当前状态重新规划，让其间被编辑过的拆分
  // 报告原因，而不是“已添加”。
  if (!added) await planSenderAdditions({ emailAccountId, id, senders });
  return { added };
}

async function planSenderAdditions({
  emailAccountId,
  id,
  senders,
}: {
  emailAccountId: string;
  id: string;
  senders: string[];
}) {
  const split = await prisma.mailSplit.findFirst({
    where: { id, emailAccountId },
    select: {
      name: true,
      matchAll: true,
      filters: {
        select: { kind: true, value: true },
        orderBy: { order: "asc" },
      },
    },
  });
  if (!split) throw new SafeError("未找到拆分");

  const result = addSendersToSplitFilters(split, senders);
  if (result.status === "incompatible") {
    throw new SafeError(
      `“${split.name}”只显示匹配其全部条件的邮件，请编辑它以添加发件人。`,
    );
  }
  if (result.status === "limit") {
    throw new SafeError(`一个拆分最多可有 ${MAX_SPLIT_FILTERS} 个条件。`);
  }
  return result;
}

export async function updateMailSplit({
  emailAccountId,
  id,
  name,
  filters,
  matchAll,
}: UpdateMailSplitBody & { emailAccountId: string }) {
  try {
    // 使用单个事务，确保拆分不会出现已重命名却仍携带旧条件的情况。条件会被整体替换，
    // 而不是进行差异比较：构建器返回它当前显示的条件，因此列表中缺失的条件即已被删除。
    const [, { count }] = await prisma.$transaction([
      lockMailSplits(emailAccountId),
      prisma.mailSplit.updateMany({
        where: { id, emailAccountId },
        data: { name, matchAll },
      }),
      // 通过拆分的所有者限定范围，因此即使 `id` 由调用方提供，其他账号的 id 也无法触及
      // 这些行。
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
    if (!count) throw new SafeError("未找到拆分");
  } catch (error) {
    if (isDuplicateError(error, "name")) {
      throw new SafeError(`你已有名为“${name}”的拆分。`);
    }
    throw error;
  }
}

export async function deleteMailSplit({
  emailAccountId,
  id,
}: DeleteMailSplitBody & { emailAccountId: string }) {
  // 使用 deleteMany 而非 delete，确保绝不会移除其他账号的 id
  const [, { count }] = await prisma.$transaction([
    lockMailSplits(emailAccountId),
    prisma.mailSplit.deleteMany({
      where: { id, emailAccountId, filters: { some: {} } },
    }),
  ]);
  if (!count) throw new SafeError("未找到拆分或该拆分无法删除");
}
