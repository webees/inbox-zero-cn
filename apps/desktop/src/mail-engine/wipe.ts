import { wipeNodeMailbox } from "@inboxzero/mail-sqlite/node";

export async function closeDesktopMailbox(
  owner?: { close(): Promise<void> } | null,
) {
  try {
    await owner?.close();
  } catch {
    // 如果所有者已经消失，登出和退出仍然继续。
  }
}

export async function closeAndWipeDesktopMailbox(input: {
  owner?: { close(): Promise<void> } | null;
  databasePath: string;
}) {
  await closeDesktopMailbox(input.owner);
  await wipeNodeMailbox(input.databasePath);
}
