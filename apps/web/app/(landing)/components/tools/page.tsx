"use client";

import { Suspense } from "react";
import { SWRConfig } from "swr";
import { AssistantInlineEmailResponse } from "@/components/assistant-chat/assistant-inline-email-response";
import { EmailLookupProvider } from "@/components/assistant-chat/email-lookup-context";
import { Container } from "@/components/Container";
import { PageHeading, SectionHeader, MutedText } from "@/components/Typography";
import {
  AddToKnowledgeBase,
  BasicToolInfo,
  CreatedRuleToolCard,
  PendingCreateRulePreviewCard,
  PendingDeleteRulePreviewCard,
  UpdatedRuleConditions,
  UpdatedRuleActions,
  UpdatedLearnedPatterns,
  UpdatedRule,
  ForwardEmailResult,
  ManageInboxResult,
  ManageSenderCategoryResult,
  ReadEmailResult,
  ReplyEmailResult,
  SearchInboxResult,
  SendEmailResult,
  type ThreadLookup,
  UpdatePersonalInstructions,
} from "@/components/assistant-chat/tools";
import { ActionType } from "@/generated/prisma/enums";
import { ChatProvider } from "@/providers/ChatProvider";
import { EmailAccountPreviewProvider } from "@/providers/EmailAccountProvider";

export default function ToolsPage() {
  const assistantToolThreadLookup = getAssistantToolThreadLookup();

  return (
    <Container>
      <div className="space-y-10 py-8">
        <PageHeading>AI 助手工具</PageHeading>

        {/* Rule Cards */}
        <section className="space-y-4">
          <SectionHeader>规则卡片</SectionHeader>

          <MutedText>已创建的规则：</MutedText>
          <CreatedRuleToolCard
            preview
            status="created"
            args={{
              name: "招聘",
              condition: {
                aiInstructions: "与招聘、求职申请或候选人沟通相关的邮件",
                static: null,
                conditionalOperator: null,
              },
              actions: [
                ruleAction(ActionType.FORWARD, { to: "jim@company.com" }),
                ruleAction(ActionType.LABEL, { label: "招聘" }),
              ],
            }}
          />
          <CreatedRuleToolCard
            preview
            status="created"
            args={{
              name: "简报归档",
              condition: {
                aiInstructions: "简报和营销邮件",
                static: {
                  from: "newsletter@example.com",
                  to: null,
                  subject: null,
                },
                conditionalOperator: "OR",
              },
              actions: [
                ruleAction(ActionType.ARCHIVE),
                ruleAction(ActionType.LABEL, { label: "简报" }),
                ruleAction(ActionType.MARK_READ),
              ],
            }}
          />
          <CreatedRuleToolCard
            preview
            status="created"
            args={{
              name: "账单提醒",
              condition: {
                aiInstructions: null,
                static: {
                  from: "billing@stripe.com",
                  to: null,
                  subject: "invoice",
                },
                conditionalOperator: null,
              },
              actions: [
                ruleAction(ActionType.LABEL, { label: "账单" }),
                ruleAction(ActionType.FORWARD, {
                  to: "finance@company.com",
                }),
              ],
            }}
          />

          <MutedText>待确认：</MutedText>
          <PendingCreateRulePreviewCard
            args={{
              name: "VIP 自动回复",
              condition: {
                aiInstructions: null,
                static: {
                  from: "vip-client@example.com",
                  to: null,
                  subject: null,
                },
                conditionalOperator: null,
              },
              actions: [
                ruleAction(ActionType.REPLY, {
                  content: "{{起草一封简短回复，答复发件人并提出下一步建议}}",
                }),
              ],
            }}
            riskMessages={[
              "高风险：AI 可自动生成并发送任意邮件内容。恶意行为者可能诱使 AI 生成不想要或不恰当的内容。",
            ]}
          />

          <MutedText>已更新的条件（无差异）：</MutedText>
          <UpdatedRuleConditions
            preview
            ruleId="demo-rule"
            args={{
              ruleName: "招聘",
              condition: {
                aiInstructions: "与招聘、求职申请或候选人沟通相关的邮件",
                static: { from: "hr@company.com", to: null, subject: null },
                conditionalOperator: "AND",
              },
            }}
            actions={[
              ruleAction(ActionType.FORWARD, { to: "jim@company.com" }),
              ruleAction(ActionType.LABEL, { label: "招聘" }),
            ]}
          />

          <MutedText>已更新的条件（有差异）：</MutedText>
          <UpdatedRuleConditions
            preview
            ruleId="demo-rule"
            args={{
              ruleName: "简报",
              condition: {
                aiInstructions: "简报、营销或推广内容的邮件",
                static: null,
                conditionalOperator: null,
              },
            }}
            actions={[
              ruleAction(ActionType.ARCHIVE),
              ruleAction(ActionType.LABEL, { label: "简报" }),
              ruleAction(ActionType.MARK_READ),
            ]}
            originalConditions={{
              aiInstructions: "看起来像简报或营销内容的邮件",
              conditionalOperator: null,
            }}
            updatedConditions={{
              aiInstructions: "简报、营销或推广内容的邮件",
              conditionalOperator: null,
            }}
          />

          <MutedText>已更新的操作：</MutedText>
          <UpdatedRuleActions
            preview
            ruleId="demo-rule"
            args={{
              ruleName: "简报归档",
              actions: [
                ruleAction(ActionType.ARCHIVE),
                ruleAction(ActionType.LABEL, { label: "简报" }),
                ruleAction(ActionType.MARK_READ),
              ],
            }}
            condition={{
              aiInstructions: "简报和营销邮件",
              static: {
                from: "newsletter@example.com",
              },
              conditionalOperator: "OR",
            }}
          />
          <UpdatedRuleActions
            preview
            ruleId="demo-rule"
            args={{
              ruleName: "招聘",
              actions: [
                ruleAction(ActionType.FORWARD, { to: "jim@company.com" }),
                ruleAction(ActionType.LABEL, { label: "招聘" }),
              ],
            }}
            condition={{
              aiInstructions: "与招聘、求职申请或候选人沟通相关的邮件",
            }}
            originalActions={[
              {
                type: ActionType.LABEL,
                fields: buildRuleActionFields({ label: "招聘" }),
              },
            ]}
            updatedActions={[
              {
                type: ActionType.FORWARD,
                fields: buildRuleActionFields({ to: "jim@company.com" }),
                delayInMinutes: null,
              },
              {
                type: ActionType.LABEL,
                fields: buildRuleActionFields({ label: "招聘" }),
                delayInMinutes: null,
              },
            ]}
          />

          <MutedText>已更新的规则状态：</MutedText>
          <UpdatedRule
            preview
            args={{
              ruleName: "简报归档",
              updates: {
                enabled: false,
              },
            }}
            output={{
              success: true,
              ruleId: "demo-rule",
              originalName: "简报归档",
              updatedName: "简报归档",
              originalEnabled: true,
              updatedEnabled: false,
            }}
          />
          <UpdatedRule
            preview
            args={{
              ruleName: "账单提醒",
              updates: {
                enabled: true,
              },
            }}
            output={{
              success: true,
              ruleId: "demo-rule",
              originalName: "账单提醒",
              updatedName: "账单提醒",
              originalEnabled: false,
              updatedEnabled: true,
            }}
          />

          <MutedText>待确认删除：</MutedText>
          <PendingDeleteRulePreviewCard
            args={{
              ruleName: "旧供应商提醒",
            }}
            output={{
              success: true,
              actionType: "delete_rule",
              requiresConfirmation: true,
              confirmationState: "pending",
              ruleId: "demo-rule",
              ruleName: "旧供应商提醒",
              wasEnabled: true,
            }}
          />

          <MutedText>已更新的学习模式：</MutedText>
          <UpdatedLearnedPatterns
            preview
            ruleId="demo-rule"
            args={{
              ruleName: "简报",
              learnedPatterns: [
                {
                  include: {
                    from: "@substack.com",
                    subject: null,
                  },
                  exclude: null,
                },
                {
                  include: null,
                  exclude: {
                    from: "team@company.com",
                    subject: null,
                  },
                },
              ],
            }}
          />
        </section>

        {/* Email Actions */}
        <section className="space-y-4">
          <SectionHeader>邮件操作</SectionHeader>
          <Suspense fallback={<BasicToolInfo text="正在加载邮件操作状态…" />}>
            <EmailAccountPreviewProvider>
              <ChatProvider>
                <AssistantEmailActionStates />
              </ChatProvider>
            </EmailAccountPreviewProvider>
          </Suspense>
        </section>

        {/* Search & Read Results */}
        <section className="space-y-4">
          <SectionHeader>搜索与阅读结果</SectionHeader>
          <SearchInboxResult outputs={[getAssistantSearchInboxOutput()]} />
          <ReadEmailResult output={getAssistantReadEmailOutput()} />
        </section>

        <section className="space-y-4">
          <SectionHeader>内联邮件视图</SectionHeader>

          <EmailLookupProvider value={assistantToolThreadLookup}>
            <SWRConfig
              value={{
                fallback: {
                  [getThreadDetailFallbackKey("thread-3")]:
                    getAssistantInlineEmailDetailThread(),
                },
                revalidateIfStale: false,
                revalidateOnFocus: false,
                revalidateOnMount: false,
              }}
            >
              <MutedText>内联邮件列表：</MutedText>
              <AssistantInlineEmailResponse>
                {getAssistantInlineEmailListMarkup()}
              </AssistantInlineEmailResponse>

              <MutedText>内联邮件详情：</MutedText>
              <AssistantInlineEmailResponse>
                {getAssistantInlineEmailDetailMarkup()}
              </AssistantInlineEmailResponse>
            </SWRConfig>
          </EmailLookupProvider>
        </section>

        {/* Error States */}
        <section className="space-y-4">
          <SectionHeader>错误状态</SectionHeader>

          <MutedText>搜索错误（显示在搜索结果卡片内）：</MutedText>
          <SearchInboxResult outputs={[getAssistantSearchInboxErrorOutput()]} />

          <MutedText>通用工具错误（多数其他工具失败时使用）：</MutedText>
          <div className="grid gap-2 md:grid-cols-2">
            <ToolErrorCardPreview error="读取邮件失败" />
            <ToolErrorCardPreview error="更新规则条件失败" />
            <ToolErrorCardPreview error="更新规则状态失败" />
            <ToolErrorCardPreview error="响应中缺少规则 ID" />
            <ToolErrorCardPreview error="无法加载邮件的规则执行记录" />
          </div>
        </section>

        {/* Manage Inbox Results */}
        <section className="space-y-4">
          <SectionHeader>管理收件箱结果</SectionHeader>
          <ManageInboxResult
            input={{
              action: "archive_threads",
              threadIds: ["thread-1", "thread-2"],
            }}
            output={{
              action: "archive_threads",
              requestedCount: 2,
              successCount: 2,
              failedCount: 0,
            }}
            threadIds={["thread-1", "thread-2"]}
            threadLookup={assistantToolThreadLookup}
          />
          <ManageInboxResult
            input={{
              action: "archive_threads",
              threadIds: ["thread-1", "thread-2", "thread-3"],
              label: "简报",
            }}
            output={{
              action: "archive_threads",
              requestedCount: 3,
              successCount: 2,
              failedCount: 1,
              failedThreadIds: ["thread-3"],
            }}
            threadIds={["thread-1", "thread-2", "thread-3"]}
            threadLookup={assistantToolThreadLookup}
          />
          <ManageInboxResult
            input={{
              action: "mark_read_threads",
              threadIds: ["thread-1", "thread-3"],
              read: true,
            }}
            output={{
              action: "mark_read_threads",
              requestedCount: 2,
              successCount: 2,
              failedCount: 0,
            }}
            threadIds={["thread-1", "thread-3"]}
            threadLookup={assistantToolThreadLookup}
          />
          <ManageInboxResult
            input={{
              action: "mark_read_threads",
              threadIds: ["thread-2"],
              read: false,
            }}
            output={{
              action: "mark_read_threads",
              requestedCount: 1,
              successCount: 1,
              failedCount: 0,
            }}
            threadIds={["thread-2"]}
            threadLookup={assistantToolThreadLookup}
          />
          <ManageInboxResult
            input={{
              action: "bulk_archive_senders",
              fromEmails: ["updates@example.com", "news@example.com"],
            }}
            output={{
              action: "bulk_archive_senders",
              sendersCount: 2,
              senders: ["updates@example.com", "news@example.com"],
            }}
            threadLookup={assistantToolThreadLookup}
          />
          <ManageInboxResult
            input={{
              action: "unsubscribe_senders",
              fromEmails: ["updates@example.com", "deals@example.com"],
            }}
            output={{
              action: "unsubscribe_senders",
              sendersCount: 2,
              senders: ["updates@example.com", "deals@example.com"],
              successCount: 2,
              failedCount: 0,
            }}
            threadLookup={assistantToolThreadLookup}
          />
        </section>

        {/* Sender Category Results */}
        <section className="space-y-4">
          <SectionHeader>发件人分类结果</SectionHeader>

          <MutedText>已归档一个小分类：</MutedText>
          <ManageSenderCategoryResult
            output={{
              success: true,
              action: "archive_category",
              category: { id: "cat-1", name: "简报" },
              sendersCount: 4,
              senders: [
                "updates@example.com",
                "news@example.com",
                "digest@example.com",
                "weekly@example.com",
              ],
              message: "已归档“简报”中来自 4 个发件人的邮件。",
            }}
          />

          <MutedText>已归档一个大分类（卡片内可滚动列表）：</MutedText>
          <ManageSenderCategoryResult
            output={{
              success: true,
              action: "archive_category",
              category: { id: "cat-2", name: "推广" },
              sendersCount: 60,
              senders: buildFakeSenderList(60, "promo"),
              message: "已归档“推广”中来自 60 个发件人的邮件。",
            }}
          />

          <MutedText>
            已归档，触发服务端上限（显示“另有 N 个未显示”）：
          </MutedText>
          <ManageSenderCategoryResult
            output={{
              success: true,
              action: "archive_category",
              category: { id: "cat-4", name: "营销" },
              sendersCount: 237,
              senders: buildFakeSenderList(100, "marketing"),
              message: "已归档“营销”中来自 237 个发件人的邮件。",
            }}
          />

          <MutedText>未分类的发件人：</MutedText>
          <ManageSenderCategoryResult
            output={{
              success: true,
              action: "archive_category",
              category: { id: null, name: "未分类" },
              sendersCount: 8,
              senders: [
                "random@example.com",
                "other@example.com",
                "misc@example.com",
                "ping@example.com",
                "alerts@example.com",
                "hello@example.com",
                "team@example.com",
                "support@example.com",
              ],
              message: "已归档“未分类”中来自 8 个发件人的邮件。",
            }}
          />

          <MutedText>空分类（无发件人）：</MutedText>
          <ManageSenderCategoryResult
            output={{
              success: true,
              action: "archive_category",
              category: { id: "cat-3", name: "收据" },
              sendersCount: 0,
              senders: [],
              message: "“收据”当前没有分配发件人。",
            }}
          />
        </section>

        {/* Settings & Knowledge */}
        <section className="space-y-4">
          <SectionHeader>设置与知识库</SectionHeader>
          <UpdatePersonalInstructions
            args={{
              personalInstructions: "我希望回复简洁，并默认归档简报。",
              mode: "replace",
            }}
          />
          <Suspense>
            <AddToKnowledgeBase
              args={{
                title: "升级偏好",
                content: "尽快升级账单类邮件，并保持状态更新简短。",
              }}
            />
          </Suspense>
        </section>

        {/* Basic Tool Info States */}
        <section className="space-y-4">
          <SectionHeader>基本工具信息状态</SectionHeader>
          <MutedText>输入状态（加载指示器）：</MutedText>
          <div className="grid gap-2 md:grid-cols-2">
            <BasicToolInfo text="正在加载账号概览……" />
            <BasicToolInfo text="正在加载助手功能……" />
            <BasicToolInfo text="正在更新设置……" />
            <BasicToolInfo text="正在搜索收件箱……" />
            <BasicToolInfo text="正在读取邮件……" />
            <BasicToolInfo text="正在归档邮件……" />
            <BasicToolInfo text="正在归档并添加标签……" />
            <BasicToolInfo text="正在将邮件标为已读……" />
            <BasicToolInfo text="正在将邮件标为未读……" />
            <BasicToolInfo text="正在按发件人批量归档……" />
            <BasicToolInfo text="正在退订发件人……" />
            <BasicToolInfo text="正在更新收件箱功能……" />
            <BasicToolInfo text="正在准备邮件……" />
            <BasicToolInfo text="正在准备回复……" />
            <BasicToolInfo text="正在准备转发……" />
            <BasicToolInfo text="正在读取规则和设置……" />
            <BasicToolInfo text="正在读取学习模式……" />
            <BasicToolInfo text="正在创建规则“简报”……" />
            <BasicToolInfo text="正在更新规则“简报”的条件……" />
            <BasicToolInfo text="正在更新规则“简报”的操作……" />
            <BasicToolInfo text="正在禁用规则“简报”……" />
            <BasicToolInfo text="正在启用规则“简报”……" />
            <BasicToolInfo text="正在准备删除规则“简报”……" />
            <BasicToolInfo text="正在更新规则“简报”的学习模式……" />
            <BasicToolInfo text="正在更新关于信息……" />
            <BasicToolInfo text="正在添加到知识库……" />
            <BasicToolInfo text="正在保存记忆……" />
            <BasicToolInfo text="正在搜索记忆……" />
            <BasicToolInfo text="正在检查发件人分类……" />
            <BasicToolInfo text="正在开始发件人分类……" />
            <BasicToolInfo text="正在检查分类进度……" />
            <BasicToolInfo text="正在归档“简报”分类……" />
          </div>

          <MutedText>输出状态（完成消息）：</MutedText>
          <div className="grid gap-2 md:grid-cols-2">
            <BasicToolInfo text="已加载账号概览" />
            <BasicToolInfo text="已加载助手功能" />
            <BasicToolInfo text="已更新设置（2 项变更）" />
            <BasicToolInfo text="已更新收件箱功能" />
            <BasicToolInfo text="已读取规则和设置" />
            <BasicToolInfo text="已读取学习模式" />
            <BasicToolInfo text="记忆已保存" />
            <BasicToolInfo text="找到 2 条记忆" />
            <BasicToolInfo text="找到 5 个分类，12 个未分类发件人" />
            <BasicToolInfo text="正在分类 43 个发件人" />
            <BasicToolInfo text="发件人分类已在进行中" />
            <BasicToolInfo text="正在分类发件人（43 个中的第 12 个）" />
            <BasicToolInfo text="分类完成" />
            <BasicToolInfo text="分类尚未开始" />
          </div>
        </section>
      </div>
    </Container>
  );
}

function AssistantEmailActionStates() {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <MutedText>Send — pending</MutedText>
        <SendEmailResult
          output={getAssistantSendEmailOutput("pending")}
          chatMessageId="assistant-demo-send-pending"
          toolCallId="assistant-demo-send-pending"
          disableConfirm={true}
        />
      </div>

      <div className="space-y-3">
        <MutedText>Send — processing</MutedText>
        <SendEmailResult
          output={getAssistantSendEmailOutput("processing")}
          chatMessageId="assistant-demo-send-processing"
          toolCallId="assistant-demo-send-processing"
          disableConfirm={true}
        />
      </div>

      <div className="space-y-3">
        <MutedText>Send — confirmed</MutedText>
        <SendEmailResult
          output={getAssistantSendEmailOutput("confirmed")}
          chatMessageId="assistant-demo-send-confirmed"
          toolCallId="assistant-demo-send-confirmed"
          disableConfirm={true}
        />
      </div>

      <div className="space-y-3">
        <MutedText>Reply — pending</MutedText>
        <ReplyEmailResult
          output={getAssistantReplyEmailOutput("pending")}
          chatMessageId="assistant-demo-reply-pending"
          toolCallId="assistant-demo-reply-pending"
          disableConfirm={true}
        />
      </div>

      <div className="space-y-3">
        <MutedText>Reply — confirmed</MutedText>
        <ReplyEmailResult
          output={getAssistantReplyEmailOutput("confirmed")}
          chatMessageId="assistant-demo-reply-confirmed"
          toolCallId="assistant-demo-reply-confirmed"
          disableConfirm={true}
        />
      </div>

      <div className="space-y-3">
        <MutedText>Forward — pending</MutedText>
        <ForwardEmailResult
          output={getAssistantForwardEmailOutput("pending")}
          chatMessageId="assistant-demo-forward-pending"
          toolCallId="assistant-demo-forward-pending"
          disableConfirm={true}
        />
      </div>

      <div className="space-y-3">
        <MutedText>Forward — confirmed</MutedText>
        <ForwardEmailResult
          output={getAssistantForwardEmailOutput("confirmed")}
          chatMessageId="assistant-demo-forward-confirmed"
          toolCallId="assistant-demo-forward-confirmed"
          disableConfirm={true}
        />
      </div>
    </div>
  );
}

type EmailActionState = "pending" | "processing" | "confirmed";

function getAssistantToolThreadLookup(): ThreadLookup {
  return new Map([
    [
      "thread-1",
      {
        messageId: "msg-1",
        from: "Daily Updates <updates@example.com>",
        subject: "Daily summary",
        snippet: "Your summary is ready",
        date: "2026-03-09T10:00:00Z",
        isUnread: true,
      },
    ],
    [
      "thread-2",
      {
        messageId: "msg-2",
        from: "Product Team <product@example.com>",
        subject: "Release notes",
        snippet: "New changes shipped today",
        date: "2026-03-09T09:00:00Z",
        isUnread: false,
      },
    ],
    [
      "thread-3",
      {
        messageId: "msg-3",
        from: "Support <support@example.com>",
        subject: "Ticket follow-up",
        snippet: "Checking in on your request",
        date: "2026-03-08T15:00:00Z",
        isUnread: true,
      },
    ],
  ]);
}

function getAssistantInlineEmailDetailThread() {
  return {
    thread: {
      id: "thread-3",
      messages: [
        {
          id: "message-3",
          threadId: "thread-3",
          subject: "工单跟进",
          snippet: "跟进您的请求",
          date: "2026-01-10T15:20:00.000Z",
          internalDate: `${Date.parse("2026-01-10T15:20:00.000Z")}`,
          historyId: "history-3",
          inline: [],
          headers: {
            from: "Support <support@example.com>",
            to: "you@example.com",
            date: "2026-01-10T15:20:00.000Z",
            subject: "工单跟进",
          },
          textPlain:
            "您好：\n\n跟进您的请求。待办事项是确认该问题是否已解决。\n\n此致\n支持团队",
        },
      ],
    },
  };
}

function getAssistantInlineEmailListMarkup() {
  return `
<emails>
  <email threadid="thread-1">每日摘要</email>
  <email threadid="thread-2">发布说明</email>
  <email threadid="thread-3">工单跟进</email>
</emails>
`.trim();
}

function getAssistantInlineEmailDetailMarkup() {
  return `
<email-detail threadid="thread-3">重点关注待办事项与当前状态。</email-detail>
`.trim();
}

function getAssistantSearchInboxOutput() {
  return {
    queryUsed: "newer_than:7d in:inbox",
    totalReturned: 3,
    nextPageToken: null,
    summary: {
      total: 3,
      unread: 2,
      byCategory: {
        update: 2,
        support: 1,
      },
    },
    messages: [
      {
        messageId: "message-1",
        threadId: "thread-1",
        subject: "每日摘要",
        from: "Daily Updates <updates@example.com>",
        snippet: "Your summary is ready",
        date: "2026-01-12T09:00:00.000Z",
        isUnread: true,
      },
      {
        messageId: "message-2",
        threadId: "thread-2",
        subject: "Release notes",
        from: "Product Team <product@example.com>",
        snippet: "New changes shipped today",
        date: "2026-01-11T18:30:00.000Z",
        isUnread: false,
      },
      {
        messageId: "message-3",
        threadId: "thread-3",
        subject: "Ticket follow-up",
        from: "Support <support@example.com>",
        snippet: "Checking in on your request",
        date: "2026-01-10T15:20:00.000Z",
        isUnread: true,
      },
    ],
  };
}

function getAssistantSearchInboxErrorOutput() {
  return {
    queryUsed: "from:updates@example.com received>=2026-01-10",
    error: "Failed to search inbox",
  };
}

function getAssistantReadEmailOutput() {
  return {
    messageId: "message-3",
    threadId: "thread-3",
    from: "Support <support@example.com>",
    to: "you@example.com",
    subject: "工单跟进",
    content:
      "您好：\n\n跟进您的请求。如需其他帮助请告诉我们。\n\n此致\n支持团队",
    date: "2026-01-10T15:20:00.000Z",
    attachments: [{ filename: "follow-up.pdf" }],
  };
}

function getThreadDetailFallbackKey(threadId: string) {
  return `/api/threads/${threadId}?`;
}

function ToolErrorCardPreview({ error }: { error: string }) {
  return <div className="text-xs text-muted-foreground">错误：{error}</div>;
}

function getAssistantSendEmailOutput(state: EmailActionState) {
  return {
    success: true,
    actionType: "send_email" as const,
    requiresConfirmation: true,
    confirmationState: state,
    pendingAction: {
      to: "user@example.com",
      cc: "ops@example.com",
      bcc: null,
      subject: "每周更新",
      messageHtml: "<p>团队好：<br/>这里是本周的更新。</p>",
      from: "Inbox Zero <assistant@example.com>",
    },
    ...(state === "confirmed"
      ? {
          confirmationResult: {
            actionType: "send_email",
            confirmedAt: "2026-01-12T10:35:00.000Z",
            messageId: "message-send-confirmed",
            threadId: "thread-send-confirmed",
            to: "user@example.com",
            subject: "每周更新",
          },
        }
      : {}),
  };
}

function getAssistantReplyEmailOutput(state: EmailActionState) {
  return {
    success: true,
    actionType: "reply_email" as const,
    requiresConfirmation: true,
    confirmationState: state,
    pendingAction: {
      messageId: "message-3",
      content: "感谢跟进。现在这个问题已解决。",
    },
    reference: {
      messageId: "message-3",
      threadId: "thread-3",
      from: "Support <support@example.com>",
      subject: "Ticket follow-up",
    },
    ...(state === "confirmed"
      ? {
          confirmationResult: {
            actionType: "reply_email",
            confirmedAt: "2026-01-12T11:05:00.000Z",
            messageId: "message-reply-confirmed",
            threadId: "thread-3",
            subject: "Re: Ticket follow-up",
          },
        }
      : {}),
  };
}

function getAssistantForwardEmailOutput(state: EmailActionState) {
  return {
    success: true,
    actionType: "forward_email" as const,
    requiresConfirmation: true,
    confirmationState: state,
    pendingAction: {
      messageId: "message-2",
      to: "finance@example.com",
      cc: null,
      bcc: null,
      content: "Forwarding this for visibility.",
    },
    reference: {
      messageId: "message-2",
      threadId: "thread-2",
      from: "Product Team <product@example.com>",
      subject: "Release notes",
    },
    ...(state === "confirmed"
      ? {
          confirmationResult: {
            actionType: "forward_email",
            confirmedAt: "2026-01-12T11:20:00.000Z",
            messageId: "message-forward-confirmed",
            threadId: "thread-forward-confirmed",
            to: "finance@example.com",
            subject: "Fwd: Release notes",
          },
        }
      : {}),
  };
}

type RuleActionFields = {
  label: string | null;
  content: string | null;
  to: string | null;
  cc: string | null;
  bcc: string | null;
  subject: string | null;
  webhookUrl: string | null;
};

type DemoRuleActionType =
  | typeof ActionType.ARCHIVE
  | typeof ActionType.LABEL
  | typeof ActionType.REPLY
  | typeof ActionType.SEND_EMAIL
  | typeof ActionType.FORWARD
  | typeof ActionType.DRAFT_EMAIL
  | typeof ActionType.MARK_SPAM
  | typeof ActionType.CALL_WEBHOOK
  | typeof ActionType.MARK_READ
  | typeof ActionType.DIGEST
  | typeof ActionType.MOVE_FOLDER;

type DemoRuleAction = {
  type: DemoRuleActionType;
  fields: RuleActionFields;
  delayInMinutes: number | null;
};

function ruleAction(
  type: DemoRuleActionType,
  fields?: Partial<RuleActionFields>,
): DemoRuleAction {
  return {
    type,
    fields: buildRuleActionFields(fields),
    delayInMinutes: null,
  };
}

function buildRuleActionFields(
  fields?: Partial<RuleActionFields>,
): RuleActionFields {
  return {
    label: fields?.label ?? null,
    content: fields?.content ?? null,
    to: fields?.to ?? null,
    cc: fields?.cc ?? null,
    bcc: fields?.bcc ?? null,
    subject: fields?.subject ?? null,
    webhookUrl: fields?.webhookUrl ?? null,
  };
}

function buildFakeSenderList(count: number, prefix: string): string[] {
  return Array.from(
    { length: count },
    (_, i) => `${prefix}-${String(i + 1).padStart(3, "0")}@example.com`,
  );
}
