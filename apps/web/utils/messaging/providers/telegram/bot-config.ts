import { callTelegramBotApi } from "@/utils/messaging/providers/telegram/api";

type TelegramBotCommand = {
  command: string;
  description: string;
};

type TelegramUser = {
  id: number;
};

type TelegramUserProfilePhotos = {
  total_count: number;
};

export const TELEGRAM_BOT_COMMANDS: TelegramBotCommand[] = [
  {
    command: "connect",
    description: "使用 /connect <code> 关联你的 Inbox Zero 账号",
  },
  {
    command: "switch",
    description: "在已关联的邮箱账号之间切换",
  },
  {
    command: "help",
    description: "查看机器人命令与提示词快捷方式",
  },
  {
    command: "cleanup",
    description: "帮我清理今天的收件箱",
  },
  {
    command: "summary",
    description: "总结今天需要关注的事项",
  },
  {
    command: "draftreply",
    description: "为我最紧急的未读邮件撰写回复草稿",
  },
  {
    command: "followups",
    description: "显示本周我应该跟进的邮件",
  },
];

export async function configureTelegramBotMetadata({
  botToken,
  profilePhotoUrl,
}: {
  botToken: string;
  profilePhotoUrl?: string;
}) {
  await setTelegramBotCommands({ botToken });

  if (!profilePhotoUrl) return;

  await setTelegramProfilePhotoIfMissing({
    botToken,
    profilePhotoUrl,
  });
}

async function setTelegramBotCommands({ botToken }: { botToken: string }) {
  const body = new URLSearchParams({
    commands: JSON.stringify(TELEGRAM_BOT_COMMANDS),
  });

  await callTelegramBotApi({
    botToken,
    apiMethod: "setMyCommands",
    body,
  });
}

async function setTelegramProfilePhotoIfMissing({
  botToken,
  profilePhotoUrl,
}: {
  botToken: string;
  profilePhotoUrl: string;
}) {
  const hasProfilePhoto = await hasTelegramProfilePhoto({ botToken });
  if (hasProfilePhoto) return;

  const imageResponse = await fetch(profilePhotoUrl, { cache: "no-store" });
  if (!imageResponse.ok) {
    throw new Error(
      `获取 Telegram 头像 URL 失败（状态码 ${imageResponse.status}）`,
    );
  }

  const imageBytes = await imageResponse.arrayBuffer();
  const contentType =
    imageResponse.headers.get("content-type")?.split(";")[0] || "image/png";

  const body = new FormData();
  body.append(
    "photo",
    JSON.stringify({ type: "static", photo: "attach://profile_photo" }),
  );
  body.append(
    "profile_photo",
    new Blob([imageBytes], { type: contentType }),
    "telegram-profile-photo",
  );

  await callTelegramBotApi({
    botToken,
    apiMethod: "setMyProfilePhoto",
    body,
  });
}

async function hasTelegramProfilePhoto({
  botToken,
}: {
  botToken: string;
}): Promise<boolean> {
  const me = await callTelegramBotApi<TelegramUser>({
    botToken,
    apiMethod: "getMe",
  });

  const profilePhotos = await callTelegramBotApi<TelegramUserProfilePhotos>({
    botToken,
    apiMethod: "getUserProfilePhotos",
    body: new URLSearchParams({
      user_id: String(me.id),
      limit: "1",
    }),
  });

  return profilePhotos.total_count > 0;
}
