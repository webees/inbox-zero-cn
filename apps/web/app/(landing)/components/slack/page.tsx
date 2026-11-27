import { Fragment, type ReactNode } from "react";
import Image from "next/image";
import { Container } from "@/components/Container";
import {
  PageHeading,
  PageSubHeading,
  SectionHeader,
  TextLink,
} from "@/components/Typography";
import { cn } from "@/utils";
import { ActionType, ThreadTrackerType } from "@/generated/prisma/enums";
import { buildSlackRuleNotificationPreviewBlocks } from "@/utils/messaging/rule-notifications";
import { buildAppHomeBlocks } from "@/utils/messaging/providers/slack/messages/app-home";
import { buildDigestBlocks } from "@/utils/messaging/providers/slack/messages/digest";
import {
  buildDocumentAskBlocks,
  buildDocumentFiledBlocks,
} from "@/utils/messaging/providers/slack/messages/document-filing";
import { buildFollowUpReminderBlocks } from "@/utils/messaging/providers/slack/messages/follow-up-reminder";
import { buildMeetingBriefingBlocks } from "@/utils/messaging/providers/slack/messages/meeting-briefing";

type SlackTextObject = {
  type: string;
  text: string;
  emoji?: boolean;
};

type SlackElement = {
  type: string;
  text?: SlackTextObject;
  placeholder?: SlackTextObject;
  options?: Array<{
    text: SlackTextObject;
    value: string;
  }>;
  url?: string;
  style?: "primary" | "danger";
  action_id?: string;
  value?: string;
};

type SlackBlock = {
  type: string;
  text?: SlackTextObject;
  elements?: SlackElement[];
  fields?: SlackTextObject[];
};

type SlackPreview = {
  title: string;
  blocks?: SlackBlock[];
  text?: string;
};

const slackPreviews: SlackPreview[] = [
  {
    title: "频道确认",
    text: "✅ Inbox Zero 已连接！你可以在本频道中提及 <@UAPP123> 来聊你的邮件。如果你启用了会议简报或附件归档通知，我也可以把它们发送到这里。",
  },
  {
    title: "连接引导私信",
    text: "✅ Inbox Zero 已连接。接下来，在 Inbox Zero 中打开“频道”来选择消息发送到哪里。要使用私密频道，请把 <@UAPP123> 邀请进去。你也可以随时私信我，聊你的邮件。",
  },
  {
    title: "自动化频道消息",
    text: "规则已匹配：一封高优先级邮件需要审核。\n\n_回复 <@UAPP123> 来聊你的邮件。_",
  },
  {
    title: "草稿回复通知",
    blocks: buildSlackRuleNotificationPreviewBlocks({
      actionId: "demo-draft-action",
      actionType: ActionType.DRAFT_MESSAGING_CHANNEL,
      email: {
        headers: {
          from: "Avery Customer <avery.customer@example.com>",
          subject: "关于上线清单和发布时间线的问题",
        },
        snippet: "你能确认迁移清单是否包含 SSO、计费交接和回滚方案吗？",
        textPlain:
          "你能确认迁移清单是否包含 SSO、计费交接和回滚方案吗？实施团队也有一些启动会上的备注。\n\n周五，Jane 写道：\n> 我们应该确认这覆盖了发布清单。",
      },
      draftContent:
        "谢谢你发来这个。清单涵盖了 SSO 和计费交接，我还加了一个回滚章节供实施团队审阅。",
      openLink: {
        label: "在 Gmail 中打开",
        url: "https://mail.example.com/thread/demo",
      },
    }) as SlackBlock[],
  },
  {
    title: "邮件通知",
    blocks: buildSlackRuleNotificationPreviewBlocks({
      actionId: "demo-notify-action",
      actionType: ActionType.NOTIFY_MESSAGING_CHANNEL,
      email: {
        headers: {
          from: "计费团队 <billing@example.com>",
          subject: "收据和账号更新",
        },
        snippet:
          "你的收据已附上。请检查账号详情，如果一切无误，请把这封邮件转发到财务工作区。",
      },
      openLink: {
        label: "在 Gmail 中打开",
        url: "https://mail.example.com/thread/demo",
      },
    }) as SlackBlock[],
  },
  {
    title: "等待回复的跟进",
    blocks: buildFollowUpReminderBlocks({
      subject: "合同条款和最终审批的后续步骤",
      counterpartyName: "Jane Partner",
      counterpartyEmail: "jane.partner@example.com",
      trackerType: ThreadTrackerType.AWAITING,
      daysSinceSent: 4,
      snippet:
        "想确认修改稿是否已经发来。\n> 周五，Jane 写道：我们会和法务一起审阅，并尽快回复。",
      threadLink: "https://mail.example.com/thread/awaiting",
      threadLinkLabel: "在 Gmail 中打开",
      trackerId: "tracker-awaiting",
    }) as SlackBlock[],
  },
  {
    title: "需要回复的跟进",
    blocks: buildFollowUpReminderBlocks({
      subject: "关于迁移方案和上线时间线的实施问题",
      counterpartyName: "Alex Customer",
      counterpartyEmail: "alex.customer@example.com",
      trackerType: ThreadTrackerType.NEEDS_REPLY,
      daysSinceSent: 1,
      snippet: "你能给我讲讲 SSO 的设置，并在周四之前确认预发布域名吗？",
      trackerId: "tracker-needs-reply",
    }) as SlackBlock[],
  },
  {
    title: "内容溢出的邮件摘要",
    blocks: buildDigestBlocks({
      date: new Date("2026-04-21T09:00:00Z"),
      ruleNames: {
        newsletters: "邮件简报",
        receipts: "收据",
      },
      itemsByRule: {
        newsletters: [
          { from: "Acme Weekly", subject: "本周产品更新" },
          { from: "Design Notes", subject: "五个值得保存的模式" },
          { from: "Morning Brief", subject: "市场和科技头条" },
          { from: "Dev Digest", subject: "值得了解的 TypeScript 变化" },
          { from: "Ops Weekly", subject: "可靠性评审" },
          { from: "Product Hunt", subject: "你可能会喜欢的新品发布" },
          { from: "Security Feed", subject: "新的依赖安全公告" },
        ],
        receipts: [
          { from: "Stripe", subject: "来自 Example App 的收据" },
          { from: "Cloud Vendor", subject: "月度账单已生成" },
        ],
      },
    }) as SlackBlock[],
  },
  {
    title: "会议简报",
    blocks: buildMeetingBriefingBlocks({
      meetingTitle: "客户实施评审",
      formattedTime: "今天下午 2:00",
      videoConferenceLink: "https://meet.example.com/customer-review",
      eventUrl: "https://calendar.example.com/event/123",
      briefingContent: {
        priorities: [],
        guests: [
          {
            name: "Jamie Lee",
            email: "jamie@example.com",
            bullets: ["负责客户团队的平台运营", "上一个会话询问进展和上线风险"],
          },
          {
            name: "Morgan Patel",
            email: "morgan@example.com",
            bullets: ["负责安全评审", "之前索取过 SSO 文档"],
          },
        ],
        internalTeamMembers: [
          { name: "Taylor Admin", email: "taylor@example.com" },
        ],
      },
    }) as SlackBlock[],
  },
  {
    title: "文档已归档",
    blocks: buildDocumentFiledBlocks({
      filename: "invoice-2026-04.pdf",
      folderPath: "Finance/Invoices/2026",
      driveProvider: "google",
      senderEmail: "vendor@example.com",
      fileId: "file_123",
    }) as SlackBlock[],
  },
  {
    title: "文档归档询问",
    blocks: buildDocumentAskBlocks({
      filename: "contract-draft-v2.docx",
      senderEmail: "legal@example.com",
      reasoning: "这看起来是一份法律合同，但提到了两个项目。",
    }) as SlackBlock[],
  },
  {
    title: "应用主页",
    blocks: buildAppHomeBlocks().blocks as SlackBlock[],
  },
];

export default function SlackComponentsPage() {
  return (
    <Container size="6xl">
      <div className="space-y-8 py-8">
        <div className="space-y-3">
          <TextLink href="/components">← 组件</TextLink>
          <div className="space-y-2">
            <PageHeading>Slack 组件</PageHeading>
            <PageSubHeading>
              Inbox Zero 发送的 Slack 消息的 Storybook 风格预览。
            </PageSubHeading>
          </div>
        </div>

        <section className="space-y-6">
          {slackPreviews.map((preview) => (
            <SlackPreviewCard key={preview.title} preview={preview} />
          ))}
        </section>
      </div>
    </Container>
  );
}

function SlackPreviewCard({ preview }: { preview: SlackPreview }) {
  return (
    <article className="space-y-3">
      <SectionHeader>{preview.title}</SectionHeader>

      <div className="min-w-0 rounded-lg border border-[#35373d] bg-[#1a1d21] p-5">
        <div className="flex items-start gap-3">
          <Image
            alt=""
            className="size-10 shrink-0 rounded-lg"
            height={40}
            src="/icons/icon-192x192.png"
            width={40}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-[15px] font-bold leading-5 text-[#f8f8f8]">
                Inbox Zero
              </span>
              <span className="rounded bg-[#383a40] px-1 text-[10px] font-bold leading-4 text-[#d1d2d3]">
                APP
              </span>
              <span className="text-[15px] leading-5 text-[#ababad]">
                上午 9:41
              </span>
            </div>
            <div className="mt-1 space-y-3 text-[15px] leading-6 text-[#d1d2d3]">
              {preview.blocks ? (
                <SlackBlocks blocks={preview.blocks} />
              ) : (
                <SlackText text={preview.text ?? ""} />
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function SlackBlocks({ blocks }: { blocks: SlackBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => (
        <SlackBlockView key={`${block.type}-${index}`} block={block} />
      ))}
    </>
  );
}

function SlackBlockView({ block }: { block: SlackBlock }) {
  if (block.type === "header") {
    return (
      <h3 className="text-[15px] font-bold leading-6 text-[#d1d2d3]">
        {renderTextObject(block.text)}
      </h3>
    );
  }

  if (block.type === "section") {
    return (
      <div className="whitespace-pre-wrap break-words">
        {renderTextObject(block.text)}
        {block.fields && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {block.fields.map((field, index) => (
              <div key={`${field.text}-${index}`}>
                {renderTextObject(field)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (block.type === "context") {
    return (
      <div className="flex flex-wrap items-center gap-1 text-[13px] leading-5 text-[#ababad]">
        {block.elements?.map((element, index) => (
          <span key={`${element.type}-${index}`}>
            {renderTextObject(element.text)}
          </span>
        ))}
      </div>
    );
  }

  if (block.type === "divider") {
    return <hr className="my-3 border-[#35373d]" />;
  }

  if (block.type === "actions") {
    return (
      <div className="flex flex-wrap gap-2 pt-1">
        {block.elements?.map((element, index) => (
          <SlackButton
            element={element}
            key={`${buttonLabel(element)}-${index}`}
          />
        ))}
      </div>
    );
  }

  return (
    <pre className="overflow-auto rounded bg-[#222529] p-2 text-xs text-[#d1d2d3]">
      {JSON.stringify(block, null, 2)}
    </pre>
  );
}

function SlackButton({ element }: { element: SlackElement }) {
  if (element.type === "static_select") {
    return (
      <button
        className="h-9 rounded border border-[#5e6167] bg-transparent px-3 text-sm font-bold text-[#f8f8f8]"
        type="button"
      >
        {element.placeholder?.text ?? "更多"} ▾
      </button>
    );
  }

  return (
    <button
      className={cn(
        "h-9 rounded border border-[#5e6167] bg-transparent px-3 text-sm font-bold text-[#f8f8f8]",
        element.style === "primary" &&
          "border-[#148567] bg-[#148567] text-white",
        element.style === "danger" && "border-[#e01e5a] text-[#e01e5a]",
      )}
      type="button"
    >
      {buttonLabel(element)}
    </button>
  );
}

function SlackText({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap break-words">{renderMrkdwn(text)}</div>
  );
}

function renderTextObject(textObject: SlackTextObject | undefined) {
  if (!textObject) return null;
  if (textObject.type === "mrkdwn") return renderMrkdwn(textObject.text);
  return textObject.text;
}

function renderMrkdwn(text: string) {
  const lines = text.split("\n");

  return lines.map((line, index) => {
    const content = line.startsWith(">") ? line.replace(/^>\s?/, "") : line;
    const rendered = renderInlineMrkdwn(content);

    if (line.startsWith(">")) {
      return (
        <blockquote
          className="my-1 border-l-4 border-[#b2b8c6] pl-3 text-[#d1d2d3]"
          key={`${line}-${index}`}
        >
          {rendered}
        </blockquote>
      );
    }

    return (
      <Fragment key={`${line}-${index}`}>
        {rendered}
        {index < lines.length - 1 ? <br /> : null}
      </Fragment>
    );
  });
}

function renderInlineMrkdwn(text: string): ReactNode[] {
  const parts = text.split(/(<[^>|]+(?:\|[^>]+)?>|`[^`]+`|\*[^*]+\*|_[^_]+_)/g);

  return parts.map((part, index) => {
    if (!part) return null;

    if (part.startsWith("<") && part.endsWith(">")) {
      return renderSlackLink(part, index);
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          className="rounded border border-[#42454a] bg-[#222529] px-1 py-0.5 text-[13px] text-[#ffa657]"
          key={`${part}-${index}`}
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <strong key={`${part}-${index}`}>
          {renderInlineMrkdwn(part.slice(1, -1))}
        </strong>
      );
    }

    if (part.startsWith("_") && part.endsWith("_")) {
      return (
        <em key={`${part}-${index}`}>
          {renderInlineMrkdwn(part.slice(1, -1))}
        </em>
      );
    }

    return decodeSlackText(part);
  });
}

function renderSlackLink(part: string, index: number) {
  const value = part.slice(1, -1);

  if (value.startsWith("@")) {
    const displayName = value === "@UAPP123" ? "@Inbox Zero" : value;

    return (
      <span
        className="rounded bg-[#132d3f] px-1 font-medium text-[#36c5f0]"
        key={`${part}-${index}`}
      >
        {displayName}
      </span>
    );
  }

  const [href = "", label] = value.split("|");
  return (
    <a
      className="font-medium text-[#36c5f0] hover:underline"
      href={href.startsWith("http") ? href : "#"}
      key={`${part}-${index}`}
      rel="noreferrer"
      target="_blank"
    >
      {label ?? href}
    </a>
  );
}

function buttonLabel(element: SlackElement) {
  return element.text?.text ?? "按钮";
}

function decodeSlackText(text: string) {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
