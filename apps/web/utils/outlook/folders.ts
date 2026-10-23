import type { MailFolder } from "@microsoft/microsoft-graph-types";
import type { OutlookClient } from "./client-types";
import type { Logger } from "@/utils/logger";
import {
  withMicrosoftGraphRetry,
  withMicrosoftGraphWriteRetry,
} from "@/utils/outlook/retry";

export type OutlookSystemFolder =
  | "INBOX"
  | "DRAFT"
  | "SENT"
  | "ARCHIVE"
  | "TRASH"
  | "SPAM";

const OUTLOOK_FOLDER_FIELDS =
  "id,displayName,childFolderCount,totalItemCount,unreadItemCount";

// 不应使用像 "/|\>" 这样的常见分隔符，因为它可能出现在文件夹名称中。
// 使用 U+2999，因为它不太可能出现在正常文本中
export const FOLDER_SEPARATOR = " ⦙ ";

export type OutlookFolder = {
  id: NonNullable<MailFolder["id"]>;
  displayName: NonNullable<MailFolder["displayName"]>;
  childFolders: OutlookFolder[];
  childFolderCount?: number;
  totalItemCount?: number;
  unreadItemCount?: number;
  systemType?: OutlookSystemFolder;
};

function convertMailFolderToOutlookFolder(folder: MailFolder): OutlookFolder {
  return {
    id: folder.id ?? "",
    displayName: folder.displayName ?? "",
    childFolders:
      folder.childFolders?.map(convertMailFolderToOutlookFolder) ?? [],
    childFolderCount: folder.childFolderCount ?? 0,
    totalItemCount: folder.totalItemCount ?? 0,
    unreadItemCount: folder.unreadItemCount ?? 0,
  };
}

export async function getOutlookRootFolders(
  client: OutlookClient,
  logger: Logger,
): Promise<OutlookFolder[]> {
  const response: { value: MailFolder[] } = await withMicrosoftGraphRetry(
    () =>
      client
        .getClient()
        .api("/me/mailFolders")
        .select(OUTLOOK_FOLDER_FIELDS)
        .top(999)
        .expand(
          `childFolders($select=${OUTLOOK_FOLDER_FIELDS};$top=999;$expand=childFolders($select=${OUTLOOK_FOLDER_FIELDS};$top=999))`,
        )
        .get(),
    logger,
  );

  return response.value.map(convertMailFolderToOutlookFolder);
}

export async function getOutlookChildFolders(
  client: OutlookClient,
  folderId: string,
  logger: Logger,
): Promise<OutlookFolder[]> {
  const response: { value: MailFolder[] } = await withMicrosoftGraphRetry(
    () =>
      client
        .getClient()
        .api(`/me/mailFolders/${folderId}/childFolders`)
        .select(OUTLOOK_FOLDER_FIELDS)
        .top(999)
        .expand(
          `childFolders($select=${OUTLOOK_FOLDER_FIELDS};$top=999;$expand=childFolders($select=${OUTLOOK_FOLDER_FIELDS};$top=999))`,
        )
        .get(),
    logger,
  );

  return response.value.map(convertMailFolderToOutlookFolder);
}

async function findOutlookFolderByName(
  client: OutlookClient,
  folderName: string,
  logger: Logger,
): Promise<OutlookFolder | undefined> {
  try {
    const response: { value: MailFolder[] } = await withMicrosoftGraphRetry(
      () =>
        client
          .getClient()
          .api("/me/mailFolders")
          .filter(`displayName eq '${folderName.replace(/'/g, "''")}'`)
          .select("id,displayName")
          .top(1)
          .get(),
      logger,
    );

    if (response.value && response.value.length > 0) {
      return convertMailFolderToOutlookFolder(response.value[0]);
    }
    return;
  } catch (error) {
    logger.warn("按名称查找文件夹时出错", { folderName, error });
    return;
  }
}

async function expandFolderChildren(
  client: OutlookClient,
  folder: OutlookFolder,
  currentDepth: number,
  maxDepth: number,
  logger: Logger,
): Promise<void> {
  if (currentDepth >= maxDepth) {
    return;
  }

  // 使用 childFolderCount 判断文件夹是否有需要获取的子项
  const hasUnfetchedChildren =
    (folder.childFolderCount ?? 0) > 0 &&
    (!folder.childFolders || folder.childFolders.length === 0);

  if (hasUnfetchedChildren) {
    try {
      folder.childFolders = await getOutlookChildFolders(
        client,
        folder.id,
        logger,
      );
    } catch (error) {
      logger.warn("获取文件夹子项失败", {
        folderId: folder.id,
        folderName: folder.displayName,
        error,
      });
      return;
    }
  }

  // 递归展开子项
  for (const child of folder.childFolders || []) {
    await expandFolderChildren(
      client,
      child,
      currentDepth + 1,
      maxDepth,
      logger,
    );
  }
}

export async function getOutlookFolderTree(
  client: OutlookClient,
  maxDepth: number | undefined,
  logger: Logger,
): Promise<OutlookFolder[]> {
  const folders = await getOutlookRootFolders(client, logger);

  // 递归展开有子项的文件夹
  // 并行分批处理以获得更好的性能
  const expandPromises: Promise<void>[] = [];

  for (const folder of folders) {
    // 如果根文件夹有未获取的子项，则展开它本身
    expandPromises.push(
      expandFolderChildren(client, folder, 1, maxDepth ?? 6, logger),
    );
  }

  await Promise.all(expandPromises);

  return folders;
}

export function addOutlookSystemFolderTypes(
  folders: OutlookFolder[],
  folderIds: Record<string, string>,
): OutlookFolder[] {
  const systemTypeById = new Map<string, OutlookSystemFolder>([
    [folderIds.inbox, "INBOX"],
    [folderIds.drafts, "DRAFT"],
    [folderIds.sentitems, "SENT"],
    [folderIds.archive, "ARCHIVE"],
    [folderIds.deleteditems, "TRASH"],
    [folderIds.junkemail, "SPAM"],
  ]);

  return folders.map((folder) => ({
    ...folder,
    systemType: systemTypeById.get(folder.id),
    childFolders: addOutlookSystemFolderTypes(folder.childFolders, folderIds),
  }));
}

export async function getOrCreateOutlookFolderIdByName(
  client: OutlookClient,
  folderName: string,
  logger: Logger,
): Promise<string> {
  const existingFolder = await findOutlookFolderByName(
    client,
    folderName,
    logger,
  );

  if (existingFolder) {
    return existingFolder.id;
  }

  try {
    const response = await withMicrosoftGraphWriteRetry(
      () =>
        client.getClient().api("/me/mailFolders").post({
          displayName: folderName,
        }),
      logger,
    );

    return response.id;
  } catch (error) {
    // 如果文件夹已经存在（竞态条件或在检查与创建之间被创建），
    // 则再次获取文件夹并返回现有文件夹 ID
    // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
    const err = error as any;
    if (err?.code === "ErrorFolderExists" || err?.statusCode === 409) {
      logger.info("文件夹已存在，获取现有文件夹", {
        folderName,
      });
      const folder = await findOutlookFolderByName(client, folderName, logger);
      if (folder) {
        return folder.id;
      }
    }
    throw error;
  }
}

export async function renameOutlookFolder(
  client: OutlookClient,
  folderId: string,
  name: string,
  logger: Logger,
): Promise<void> {
  await withMicrosoftGraphWriteRetry(
    () =>
      client
        .getClient()
        .api(`/me/mailFolders/${encodeURIComponent(folderId)}`)
        .patch({ displayName: name }),
    logger,
  );
}

export async function deleteOutlookFolder(
  client: OutlookClient,
  folderId: string,
  logger: Logger,
): Promise<void> {
  await withMicrosoftGraphWriteRetry(
    () =>
      client
        .getClient()
        .api(`/me/mailFolders/${encodeURIComponent(folderId)}`)
        .delete(),
    logger,
  );
}

export function flattenOutlookFolders(
  folders: OutlookFolder[],
  parentPath = "",
): Array<OutlookFolder & { path: string }> {
  return folders.flatMap((folder) => {
    const path = parentPath
      ? `${parentPath}${FOLDER_SEPARATOR}${folder.displayName}`
      : folder.displayName;
    return [
      { ...folder, path },
      ...flattenOutlookFolders(folder.childFolders, path),
    ];
  });
}
