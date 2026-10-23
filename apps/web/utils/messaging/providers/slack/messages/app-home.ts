import type { KnownBlock, Block } from "@slack/types";

type AppHomeView = {
  type: "home";
  blocks: (KnownBlock | Block)[];
};

export function buildAppHomeBlocks(): AppHomeView {
  return {
    type: "home",
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "欢迎使用 Inbox Zero",
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "你的 AI 邮件助手，就在 Slack 里。询问收件箱相关的问题、获取会议简报、撰写回复草稿，轻松掌握重要事项。",
        },
      },
      { type: "divider" },
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "快速上手",
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*1.* 在 <https://www.getinboxzero.com|getinboxzero.com> 连接你的邮箱\n*2.* 在“渠道”页面连接 Slack\n*3.* 选择通知的发送位置（邮件提醒、回复草稿、会议简报）\n*4.* 私信我或在任意渠道 @提及 我，即可聊聊你的邮件",
        },
      },
      { type: "divider" },
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "斜杠命令",
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            "*`/summary`* — 今天需要你关注的事项",
            "*`/draftreply`* — 为你最重要的邮件撰写回复草稿",
            "*`/cleanup`* — 收件箱清理建议",
            "*`/followups`* — 本周需要跟进的邮件",
            "*`/help`* — 查看所有可用命令",
          ].join("\n"),
        },
      },
      { type: "divider" },
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "与 Inbox Zero 对话",
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: '私信我，或在某个渠道 @提及 我。可以试试：\n• _"今天我从 Acme 收到了哪些邮件？"_\n• _"针对最近这封招聘邮件，草拟一封礼貌的谢绝回复"_\n• _"总结我和 Sarah 关于 Q2 预算的会话"_',
        },
      },
      { type: "divider" },
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "功能",
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*会议简报* — 在会议开始前获取参会人信息简报，并发送到你指定的 Slack 渠道。\n\n*附件归档* — Inbox Zero 可以自动把附件归档到 Google Drive，并在这里通知你。\n\n*AI 自动化* — 设置规则来自动打标签、归档或撰写回复草稿。可在 <https://www.getinboxzero.com|getinboxzero.com> 配置。",
        },
      },
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "<https://www.getinboxzero.com|设置> · <https://www.getinboxzero.com/support|支持> · <https://www.getinboxzero.com/privacy|隐私政策>",
          },
        ],
      },
    ],
  };
}
