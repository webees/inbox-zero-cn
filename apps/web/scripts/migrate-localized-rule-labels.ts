// 把系统规则名、发件人分类名、拆分收件箱名称，以及邮箱服务商上的
// 标签/类别/文件夹名从英文迁移成中文。
//
// 演练（默认，只统计不写入）：
//   pnpm --filter inbox-zero-ai exec tsx scripts/migrate-localized-rule-labels.ts
// 实际写入：
//   pnpm --filter inbox-zero-ai exec tsx scripts/migrate-localized-rule-labels.ts --apply
//
// 可选参数：
//   --email-account <id>   只处理一个邮箱账号（排障用）
//   --skip-provider        只改数据库，不去重命名 Gmail/Outlook 上的标签
//   --limit <n>            最多处理 n 个邮箱账号
//
// 脚本是幂等的：已经是中文的行会被跳过，可以反复运行。

import "dotenv/config";
import prisma from "@/utils/prisma";
import { createScopedLogger, type Logger } from "@/utils/logger";
import type { EmailProvider } from "@/utils/email/types";
import { flattenOutlookFolders } from "@/utils/outlook/folders";
import { SystemType } from "@/generated/prisma/enums";
import {
  getRuleConfig,
  getRuleLabel,
  isDefaultRuleInstructions,
} from "@/utils/rule/consts";
import { defaultCategory } from "@/utils/categories";

const logger = createScopedLogger("migrate-localized-rule-labels");

/**
 * 每个系统类型的旧英文名。
 * 新名字直接取 `getRuleLabel()`，这样迁移脚本与运行时配置不会走偏。
 */
const SYSTEM_TYPE_ALIASES: Array<{
  systemType: SystemType;
  aliases: string[];
}> = [
  { systemType: SystemType.TO_REPLY, aliases: ["To Reply"] },
  { systemType: SystemType.AWAITING_REPLY, aliases: ["Awaiting Reply"] },
  { systemType: SystemType.FYI, aliases: ["FYI"] },
  { systemType: SystemType.ACTIONED, aliases: ["Actioned"] },
  { systemType: SystemType.NEWSLETTER, aliases: ["Newsletter", "Newsletters"] },
  { systemType: SystemType.MARKETING, aliases: ["Marketing"] },
  { systemType: SystemType.CALENDAR, aliases: ["Calendar"] },
  { systemType: SystemType.RECEIPT, aliases: ["Receipt", "Receipts"] },
  {
    systemType: SystemType.NOTIFICATION,
    aliases: ["Notification", "Notifications"],
  },
  { systemType: SystemType.OTP, aliases: ["OTP"] },
  { systemType: SystemType.COLD_EMAIL, aliases: ["Cold Email", "Cold email"] },
];

/** 默认发件人分类的旧英文名。 */
const CATEGORY_ALIASES = new Map<string, string>([
  ["Other", defaultCategory.OTHER.name],
  ["Newsletter", defaultCategory.NEWSLETTER.name],
  ["Marketing", defaultCategory.MARKETING.name],
  ["Receipt", defaultCategory.RECEIPT.name],
  ["Notification", defaultCategory.NOTIFICATION.name],
]);

const OLD_NAME_TO_NEW = new Map<string, string>(
  SYSTEM_TYPE_ALIASES.flatMap(({ systemType, aliases }) =>
    aliases.map((alias) => [alias, getRuleLabel(systemType)] as const),
  ),
);

/**
 * 内置默认分栏（全部 / 未读）的旧英文名。
 * 目标名与 `initial-splits.ts` 的 `INITIAL_MAIL_SPLITS` 逐字一致：
 * 只重命名仍是旧默认名的行，用户自己改过名字的分栏不动。
 */
const DEFAULT_SPLIT_ALIASES = new Map<string, string>([
  ["All", "全部"],
  ["Unread", "未读"],
]);

type Stats = {
  accounts: number;
  rulesRenamed: number;
  instructionsUpdated: number;
  ruleNameConflicts: number;
  actionLabelsRenamed: number;
  actionFoldersRenamed: number;
  categoriesRenamed: number;
  categoryConflicts: number;
  splitsRenamed: number;
  splitConflicts: number;
  labelsRenamed: number;
  labelConflicts: number;
  labelsAlreadyLocalized: number;
  labelsNotFound: number;
  foldersRenamed: number;
  folderConflicts: number;
  providerErrors: number;
};

function emptyStats(): Stats {
  return {
    accounts: 0,
    rulesRenamed: 0,
    instructionsUpdated: 0,
    ruleNameConflicts: 0,
    actionLabelsRenamed: 0,
    actionFoldersRenamed: 0,
    categoriesRenamed: 0,
    categoryConflicts: 0,
    splitsRenamed: 0,
    splitConflicts: 0,
    labelsRenamed: 0,
    labelConflicts: 0,
    labelsAlreadyLocalized: 0,
    labelsNotFound: 0,
    foldersRenamed: 0,
    folderConflicts: 0,
    providerErrors: 0,
  };
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const stats = emptyStats();

  const emailAccounts = await prisma.emailAccount.findMany({
    where: options.emailAccountId ? { id: options.emailAccountId } : undefined,
    select: {
      id: true,
      email: true,
      account: { select: { provider: true } },
    },
    orderBy: { createdAt: "asc" },
    ...(options.limit ? { take: options.limit } : {}),
  });

  logger.info("开始迁移本地化名称", {
    apply: options.apply,
    skipProvider: options.skipProvider,
    emailAccounts: emailAccounts.length,
  });

  for (const emailAccount of emailAccounts) {
    stats.accounts += 1;
    logger.info("处理邮箱账号", {
      email: emailAccount.email,
      provider: emailAccount.account.provider,
    });

    await migrateDatabaseNames(emailAccount.id, stats, options);

    if (!options.skipProvider) {
      await migrateProviderNames(emailAccount, stats, options);
    }
  }

  printSummary(stats, options);
}

async function migrateDatabaseNames(
  emailAccountId: string,
  stats: Stats,
  options: Options,
) {
  const systemRules = await prisma.rule.findMany({
    where: { emailAccountId, systemType: { not: null } },
    select: { id: true, name: true, systemType: true },
  });

  for (const rule of systemRules) {
    if (!rule.systemType) continue;

    const nextName = getRuleLabel(rule.systemType);
    if (rule.name === nextName) continue;
    // 只迁移仍然是旧默认名的规则，用户自己改过的名字不动。
    if (OLD_NAME_TO_NEW.get(rule.name) !== nextName) continue;

    const clash = await prisma.rule.findFirst({
      where: {
        emailAccountId,
        name: nextName,
        id: { not: rule.id },
      },
      select: { id: true },
    });
    if (clash) {
      stats.ruleNameConflicts += 1;
      logger.warn("规则名冲突，跳过", {
        ruleId: rule.id,
        from: rule.name,
        to: nextName,
        conflictingRuleId: clash.id,
      });
      continue;
    }

    stats.rulesRenamed += 1;
    if (options.apply) {
      await prisma.rule.update({
        where: { id: rule.id },
        data: { name: nextName },
      });
    }
  }

  // 提示词也存在规则行里：默认提示词改成中文后，仍停留在默认值的行要一并改写；
  // 用户自己改过的提示词不动（isDefaultRuleInstructions 能识别历史默认值）。
  const rulesWithInstructions = await prisma.rule.findMany({
    where: { emailAccountId, systemType: { not: null } },
    select: { id: true, systemType: true, instructions: true },
  });

  for (const rule of rulesWithInstructions) {
    if (!rule.systemType) continue;

    const nextInstructions = getRuleConfig(rule.systemType).instructions;
    if (rule.instructions === nextInstructions) continue;
    if (!isDefaultRuleInstructions(rule.systemType, rule.instructions))
      continue;

    stats.instructionsUpdated += 1;
    if (options.apply) {
      await prisma.rule.update({
        where: { id: rule.id },
        data: { instructions: nextInstructions },
      });
    }
  }

  const systemActions = await prisma.action.findMany({
    where: { emailAccountId, rule: { systemType: { not: null } } },
    select: { id: true, label: true, folderName: true },
  });

  for (const action of systemActions) {
    const nextLabel = action.label
      ? OLD_NAME_TO_NEW.get(action.label)
      : undefined;
    if (nextLabel && nextLabel !== action.label) {
      stats.actionLabelsRenamed += 1;
      if (options.apply) {
        await prisma.action.update({
          where: { id: action.id },
          data: { label: nextLabel },
        });
      }
    }

    const nextFolder = action.folderName
      ? OLD_NAME_TO_NEW.get(action.folderName)
      : undefined;
    if (nextFolder && nextFolder !== action.folderName) {
      stats.actionFoldersRenamed += 1;
      if (options.apply) {
        await prisma.action.update({
          where: { id: action.id },
          data: { folderName: nextFolder },
        });
      }
    }
  }

  const categories = await prisma.category.findMany({
    where: { emailAccountId },
    select: { id: true, name: true },
  });

  for (const category of categories) {
    const nextName = CATEGORY_ALIASES.get(category.name);
    if (!nextName || nextName === category.name) continue;

    const clash = await prisma.category.findFirst({
      where: { emailAccountId, name: nextName, id: { not: category.id } },
      select: { id: true },
    });
    if (clash) {
      stats.categoryConflicts += 1;
      logger.warn("分类名冲突，跳过", {
        categoryId: category.id,
        from: category.name,
        to: nextName,
      });
      continue;
    }

    stats.categoriesRenamed += 1;
    if (options.apply) {
      await prisma.category.update({
        where: { id: category.id },
        data: { name: nextName },
      });
    }
  }

  const splits = await prisma.mailSplit.findMany({
    where: { emailAccountId },
    select: { id: true, name: true },
  });

  for (const split of splits) {
    const nextName =
      DEFAULT_SPLIT_ALIASES.get(split.name) ?? OLD_NAME_TO_NEW.get(split.name);
    if (!nextName || nextName === split.name) continue;

    const clash = await prisma.mailSplit.findFirst({
      where: { emailAccountId, name: nextName, id: { not: split.id } },
      select: { id: true },
    });
    if (clash) {
      stats.splitConflicts += 1;
      logger.warn("拆分名称冲突，跳过", {
        mailSplitId: split.id,
        from: split.name,
        to: nextName,
      });
      continue;
    }

    stats.splitsRenamed += 1;
    if (options.apply) {
      await prisma.mailSplit.update({
        where: { id: split.id },
        data: { name: nextName },
      });
    }
  }
}

async function migrateProviderNames(
  emailAccount: {
    id: string;
    email: string;
    account: { provider: string };
  },
  stats: Stats,
  options: Options,
) {
  const emailAccountId = emailAccount.id;

  let provider: EmailProvider;
  try {
    provider = await buildProvider(
      emailAccountId,
      emailAccount.account.provider,
      logger,
    );
  } catch (error) {
    stats.providerErrors += 1;
    logger.error("创建邮件服务商失败，跳过服务商标签迁移", {
      email: emailAccount.email,
      error,
    });
    return;
  }

  // 优先按系统规则 action 里记录的 labelId 精确重命名；
  // 没有 labelId 的老数据再按「旧英文名 / 当前中文名」回退查找。
  // 这样无论数据库迁移跑没跑过，邮箱上仍是英文名的标签都能被找到。
  const labelTargets = new Map<
    string,
    { labelId: string | null; oldNames: string[]; nextName: string }
  >();

  const labelActions = await prisma.action.findMany({
    where: {
      emailAccountId,
      label: { not: null },
      rule: { systemType: { not: null } },
    },
    select: {
      label: true,
      labelId: true,
      rule: { select: { systemType: true } },
    },
  });

  for (const action of labelActions) {
    const systemType = action.rule.systemType;
    if (!action.label || !systemType) continue;

    // 两种情况都要能处理：
    //   1) 还没跑数据库迁移：action.label 是旧英文名，直接映射到中文；
    //   2) 已经跑过数据库迁移：action.label 已是中文，此时目标名就是它自己，
    //      靠 labelId 去邮箱上找仍是英文名的标签并改名。
    const nextName =
      OLD_NAME_TO_NEW.get(action.label) ??
      (action.label === getRuleLabel(systemType) ? action.label : undefined);
    if (!nextName) continue;

    const oldNames = [
      ...(SYSTEM_TYPE_ALIASES.find((entry) => entry.systemType === systemType)
        ?.aliases ?? []),
      getRuleLabel(systemType),
    ];
    const key = action.labelId ? `id:${action.labelId}` : `name:${nextName}`;
    labelTargets.set(key, {
      labelId: action.labelId,
      oldNames,
      nextName,
    });
  }

  if (labelTargets.size === 0) return;

  const providerLabels = await provider.getLabels();

  for (const target of labelTargets.values()) {
    const label =
      (target.labelId
        ? providerLabels.find((item) => item.id === target.labelId)
        : undefined) ??
      providerLabels.find((item) =>
        target.oldNames.some(
          (name) => normalize(item.name) === normalize(name),
        ),
      );

    if (!label) {
      stats.labelsNotFound += 1;
      logger.warn("服务商上找不到待重命名的标签", {
        email: emailAccount.email,
        labelId: target.labelId,
        oldNames: target.oldNames,
      });
      continue;
    }

    if (normalize(label.name) === normalize(target.nextName)) {
      stats.labelsAlreadyLocalized += 1;
      continue;
    }

    const clash = providerLabels.find(
      (item) =>
        item.id !== label.id &&
        normalize(item.name) === normalize(target.nextName),
    );
    if (clash) {
      stats.labelConflicts += 1;
      logger.warn("服务商上已存在同名标签，跳过重命名", {
        email: emailAccount.email,
        labelId: label.id,
        oldName: label.name,
        to: target.nextName,
        conflictingLabelId: clash.id,
      });
      continue;
    }

    stats.labelsRenamed += 1;
    if (options.apply) {
      await provider.renameLabel(label.id, target.nextName);
    }
  }

  // Outlook 用文件夹承接一部分分类动作，文件夹名同样需要跟随。
  if (emailAccount.account.provider !== "microsoft") return;

  const folderTargets = new Map<
    string,
    { oldName: string; nextName: string }
  >();
  const folderActions = await prisma.action.findMany({
    where: {
      emailAccountId,
      folderName: { not: null },
      rule: { systemType: { not: null } },
    },
    select: { folderName: true },
  });
  for (const action of folderActions) {
    if (!action.folderName) continue;
    const nextName = OLD_NAME_TO_NEW.get(action.folderName);
    if (!nextName || nextName === action.folderName) continue;
    folderTargets.set(normalize(action.folderName), {
      oldName: action.folderName,
      nextName,
    });
  }
  if (folderTargets.size === 0) return;

  const folders = flattenOutlookFolders(await provider.getFolders());
  for (const target of folderTargets.values()) {
    const folder = folders.find(
      (item) => normalize(item.displayName) === normalize(target.oldName),
    );
    if (!folder) continue;

    const clash = folders.find(
      (item) =>
        item.id !== folder.id &&
        normalize(item.displayName) === normalize(target.nextName),
    );
    if (clash) {
      stats.folderConflicts += 1;
      logger.warn("已存在同名文件夹，跳过重命名", {
        email: emailAccount.email,
        folderId: folder.id,
        oldName: folder.displayName,
        to: target.nextName,
      });
      continue;
    }

    stats.foldersRenamed += 1;
    if (options.apply) {
      await provider.renameFolder(folder.id, target.nextName);
    }
  }
}

/**
 * 直接构造服务商，而不是走 `createEmailProvider`：
 * 后者会引入 `server-only` 的限流模块，脚本在 Node 里无法加载。
 *
 * 这里用动态 import：只迁移数据库时（--skip-provider）完全不需要加载
 * Gmail/Outlook 那套依赖（它们会牵进 next/react 的客户端模块，在纯 Node 下跑不起来）。
 */
async function buildProvider(
  emailAccountId: string,
  provider: string,
  scriptLogger: Logger,
): Promise<EmailProvider> {
  if (provider === "google") {
    const [{ getGmailClientForEmail }, { GmailProvider }] = await Promise.all([
      import("@/utils/email-account-client"),
      import("@/utils/email/google"),
    ]);
    const client = await getGmailClientForEmail({
      emailAccountId,
      logger: scriptLogger,
    });
    return new GmailProvider(client, scriptLogger, emailAccountId);
  }

  if (provider === "microsoft") {
    const [{ getOutlookClientForEmail }, { OutlookProvider }] =
      await Promise.all([
        import("@/utils/email-account-client"),
        import("@/utils/email/microsoft"),
      ]);
    const client = await getOutlookClientForEmail({
      emailAccountId,
      logger: scriptLogger,
    });
    return new OutlookProvider(client, scriptLogger);
  }

  throw new Error(`不支持的邮件服务商: ${provider}`);
}

type Options = {
  apply: boolean;
  skipProvider: boolean;
  emailAccountId?: string;
  limit?: number;
};

function parseOptions(argv: string[]): Options {
  const options: Options = { apply: false, skipProvider: false };

  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    index += 1;
    switch (arg) {
      case "--apply":
        options.apply = true;
        break;
      case "--skip-provider":
        options.skipProvider = true;
        break;
      case "--email-account": {
        const value = argv[index];
        index += 1;
        if (!value) throw new Error("--email-account 需要一个值");
        options.emailAccountId = value;
        break;
      }
      case "--limit": {
        const value = Number(argv[index]);
        index += 1;
        if (!Number.isInteger(value) || value <= 0)
          throw new Error("--limit 需要正整数");
        options.limit = value;
        break;
      }
      default:
        throw new Error(`未知参数: ${arg}`);
    }
  }

  return options;
}

function printSummary(stats: Stats, options: Options) {
  const mode = options.apply ? "已写入" : "演练（未写入）";
  logger.info(`迁移完成：${mode}`, stats);
  // 直接打印一份人类可读的汇总，方便在 CI/终端里核对。
  console.log(`\n迁移结果（${mode}）`);
  for (const [key, value] of Object.entries(stats)) {
    console.log(`  ${key}: ${value}`);
  }
  if (!options.apply) {
    console.log("\n这是演练。加 --apply 才会真正写入。\n");
  }
}

main()
  .catch((error) => {
    logger.error("迁移失败", { error });
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
