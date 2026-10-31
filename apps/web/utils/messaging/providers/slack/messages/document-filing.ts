import type { KnownBlock, Block } from "@slack/types";
import { getDriveFileUrl } from "@/utils/drive/url";
import type { DriveProviderType } from "@/utils/drive/types";

export type DocumentFiledBlocksParams = {
  filename: string;
  folderPath: string;
  driveProvider: string;
  senderEmail?: string | null;
  fileId?: string | null;
};

export type DocumentAskBlocksParams = {
  filename: string;
  reasoning: string | null;
  senderEmail?: string | null;
};

export function buildDocumentFiledBlocks({
  filename,
  folderPath,
  driveProvider,
  senderEmail,
  fileId,
}: DocumentFiledBlocksParams): (KnownBlock | Block)[] {
  const fileLink =
    fileId && (driveProvider === "google" || driveProvider === "microsoft")
      ? getDriveFileUrl(fileId, driveProvider as DriveProviderType)
      : null;

  const fileDisplay = fileLink ? `<${fileLink}|${filename}>` : `*${filename}*`;

  const fromPart = senderEmail ? `，来自 *${senderEmail}*` : "";

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📨 已将 ${fileDisplay}${fromPart} 归档到 *${folderPath}*`,
      },
    },
  ];
}

export function buildDocumentAskBlocks({
  filename,
  reasoning,
  senderEmail,
}: DocumentAskBlocksParams): (KnownBlock | Block)[] {
  const fromPart = senderEmail ? `，来自 *${senderEmail}*` : "";
  const reasonPart = reasoning ? ` — ${reasoning}` : "";

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📄 我该把 *${filename}*${fromPart} 归档到哪里？${reasonPart}`,
      },
    },
  ];
}
