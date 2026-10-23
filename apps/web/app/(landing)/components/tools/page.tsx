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
        <PageHeading>助手工具</PageHeading>

        {/* 规则卡片 */}
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
              name: "邮件简报归档",
              condition: {
                aiInstructions: "邮件简报和营销邮件",
                static: {
                  from: "newsletter@example.com",
                  to: null,
                  subject: null,
                },
                conditionalOperator: "OR",
              },
              actions: [
                ruleAction(ActionType.ARCHIVE),
                ruleAction(ActionType.LABEL, { label: "邮件简报" }),
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
                  subject: "账单",
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

          <MutedText>等待确认：</MutedText>
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
                  content: "{{起草一封简短的回复，回答发件人并提出下一步}}",
                }),
              ],
            }}
            riskMessages={[
              "高风险：AI 可以自动生成并发送任何邮件内容。恶意行为者可能会诱骗 AI 生成不想要或不恰当的内容。",
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
              ruleName: "邮件简报",
              condition: {
                aiInstructions: "属于邮件简报、营销或推广内容的邮件",
                static: null,
                conditionalOperator: null,
              },
            }}
            actions={[
              ruleAction(ActionType.ARCHIVE),
              ruleAction(ActionType.LABEL, { label: "邮件简报" }),
              ruleAction(ActionType.MARK_READ),
            ]}
            originalConditions={{
              aiInstructions: "看起来像邮件简报或营销邮件的邮件",
              conditionalOperator: null,
            }}
            updatedConditions={{
              aiInstructions: "属于邮件简报、营销或推广内容的邮件",
              conditionalOperator: null,
            }}
          />

          <MutedText>已更新的操作：</MutedText>
          <UpdatedRuleActions
            preview
            ruleId="demo-rule"
            args={{
              ruleName: "邮件简报归档",
              actions: [
                ruleAction(ActionType.ARCHIVE),
                ruleAction(ActionType.LABEL, { label: "邮件简报" }),
                ruleAction(ActionType.MARK_READ),
              ],
            }}
            condition={{
              aiInstructions: "邮件简报和营销邮件",
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
              ruleName: "邮件简报归档",
              updates: {
                enabled: false,
              },
            }}
            output={{
              success: true,
              ruleId: "demo-rule",
              originalName: "邮件简报归档",
              updatedName: "邮件简报归档",
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

          <MutedText>等待删除确认：</MutedText>
          <PendingDeleteRulePreviewCard
            args={{
              ruleName: "旧的供应商提醒",
            }}
            output={{
              success: true,
              actionType: "delete_rule",
              requiresConfirmation: true,
              confirmationState: "pending",
              ruleId: "demo-rule",
              ruleName: "旧的供应商提醒",
              wasEnabled: true,
            }}
          />

          <MutedText>已更新的学习模式：</MutedText>
          <UpdatedLearnedPatterns
            preview
            ruleId="demo-rule"
            args={{
              ruleName: "邮件简报",
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

        {/* 邮件操作 */}
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

        {/* 搜索和读取结果 */}
        <section className="space-y-4">
          <SectionHeader>搜索和读取结果</SectionHeader>
          <SearchInboxResult output={getAssistantSearchInboxOutput()} />
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

        {/* 错误状态 */}
        <section className="space-y-4">
          <SectionHeader>错误状态</SectionHeader>

          <MutedText>搜索错误（内联显示在搜索结果卡片中）：</MutedText>
          <SearchInboxResult output={getAssistantSearchInboxErrorOutput()} />

          <MutedText>通用工具错误（用于大多数其他失败的工具）：</MutedText>
          <div className="grid gap-2 md:grid-cols-2">
            <ToolErrorCardPreview error="无法读取邮件" />
            <ToolErrorCardPreview error="无法更新规则条件" />
            <ToolErrorCardPreview error="无法更新规则状态" />
            <ToolErrorCardPreview error="响应中缺少规则 ID" />
            <ToolErrorCardPreview error="无法加载邮件的规则执行记录" />
          </div>
        </section>

        {/* 管理收件箱结果 */}
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
              label: "邮件简报",
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

        {/* 发件人分类结果 */}
        <section className="space-y-4">
          <SectionHeader>发件人分类结果</SectionHeader>

          <MutedText>已归档一个小分类：</MutedText>
          <ManageSenderCategoryResult
            output={{
              success: true,
              action: "archive_category",
              category: { id: "cat-1", name: "邮件简报" },
              sendersCount: 4,
              senders: [
                "updates@example.com",
                "news@example.com",
                "digest@example.com",
                "weekly@example.com",
              ],
              message: "已归档“邮件简报”中 4 个发件人的邮件。",
            }}
          />

          <MutedText>已归档一个大分类（卡片内为可滚动列表）：</MutedText>
          <ManageSenderCategoryResult
            output={{
              success: true,
              action: "archive_category",
              category: { id: "cat-2", name: "推广邮件" },
              sendersCount: 60,
              senders: buildFakeSenderList(60, "promo"),
              message: "已归档“推广邮件”中 60 个发件人的邮件。",
            }}
          />

          <MutedText>达到服务端上限时归档（未显示“+ N 更多”）：</MutedText>
          <ManageSenderCategoryResult
            output={{
              success: true,
              action: "archive_category",
              category: { id: "cat-4", name: "营销" },
              sendersCount: 237,
              senders: buildFakeSenderList(100, "marketing"),
              message: "已归档“营销”中 237 个发件人的邮件。",
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
              message: "已归档“未分类”中 8 个发件人的邮件。",
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
              message: "“收据”当前没有分配任何发件人。",
            }}
          />
        </section>

        {/* 设置和知识库 */}
        <section className="space-y-4">
          <SectionHeader>设置和知识库</SectionHeader>
          <UpdatePersonalInstructions
            args={{
              personalInstructions:
                "我更喜欢简洁的回复，并希望默认归档邮件简报。",
              mode: "replace",
            }}
          />
          <Suspense>
            <AddToKnowledgeBase
              args={{
                title: "升级偏好",
                content: "快速升级账单邮件，并保持状态更新简短。",
              }}
            />
          </Suspense>
        </section>

        {/* 基础工具信息状态 */}
        <section className="space-y-4">
          <SectionHeader>基础工具信息状态</SectionHeader>
          <MutedText>输入状态（加载指示器）：</MutedText>
          <div className="grid gap-2 md:grid-cols-2">
            <BasicToolInfo text="正在加载账号概览…" />
            <BasicToolInfo text="正在加载助手功能…" />
            <BasicToolInfo text="正在更新设置…" />
            <BasicToolInfo text="正在搜索收件箱…" />
            <BasicToolInfo text="正在读取邮件…" />
            <BasicToolInfo text="正在归档邮件…" />
            <BasicToolInfo text="正在归档并给邮件打标签…" />
            <BasicToolInfo text="正在将邮件标记为已读…" />
            <BasicToolInfo text="正在将邮件标记为未读…" />
            <BasicToolInfo text="正在按发件人批量归档…" />
            <BasicToolInfo text="正在退订发件人…" />
            <BasicToolInfo text="正在更新收件箱功能…" />
            <BasicToolInfo text="正在准备邮件…" />
            <BasicToolInfo text="正在准备回复…" />
            <BasicToolInfo text="正在准备转发…" />
            <BasicToolInfo text="正在读取规则和设置…" />
            <BasicToolInfo text="正在读取学习模式…" />
            <BasicToolInfo text="正在创建规则“邮件简报”…" />
            <BasicToolInfo text="正在更新规则“邮件简报”的条件…" />
            <BasicToolInfo text="正在更新规则“邮件简报”的操作…" />
            <BasicToolInfo text="正在停用规则“邮件简报”…" />
            <BasicToolInfo text="正在启用规则“邮件简报”…" />
            <BasicToolInfo text="正在准备删除规则“邮件简报”…" />
            <BasicToolInfo text="正在更新规则“邮件简报”的学习模式…" />
            <BasicToolInfo text="正在更新个人简介…" />
            <BasicToolInfo text="正在添加到知识库…" />
            <BasicToolInfo text="正在保存记忆…" />
            <BasicToolInfo text="正在搜索记忆…" />
            <BasicToolInfo text="正在检查发件人分类…" />
            <BasicToolInfo text="正在开始发件人分类…" />
            <BasicToolInfo text="正在检查分类进度…" />
            <BasicToolInfo text="正在归档“邮件简报”分类…" />
          </div>

          <MutedText>输出状态（完成消息）：</MutedText>
          <div className="grid gap-2 md:grid-cols-2">
            <BasicToolInfo text="已加载账号概览" />
            <BasicToolInfo text="已加载助手功能" />
            <BasicToolInfo text="设置已更新（2 处变更）" />
            <BasicToolInfo text="收件箱功能已更新" />
            <BasicToolInfo text="已读取规则和设置" />
            <BasicToolInfo text="已读取学习模式" />
            <BasicToolInfo text="记忆已保存" />
            <BasicToolInfo text="找到 2 条记忆" />
            <BasicToolInfo text="找到 5 个分类、12 个未分类的发件人" />
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
        <MutedText>发送 — 等待中</MutedText>
        <SendEmailResult
          output={getAssistantSendEmailOutput("pending")}
          chatMessageId="assistant-demo-send-pending"
          toolCallId="assistant-demo-send-pending"
          disableConfirm={true}
        />
      </div>

      <div className="space-y-3">
        <MutedText>发送 — 处理中</MutedText>
        <SendEmailResult
          output={getAssistantSendEmailOutput("processing")}
          chatMessageId="assistant-demo-send-processing"
          toolCallId="assistant-demo-send-processing"
          disableConfirm={true}
        />
      </div>

      <div className="space-y-3">
        <MutedText>发送 — 已确认</MutedText>
        <SendEmailResult
          output={getAssistantSendEmailOutput("confirmed")}
          chatMessageId="assistant-demo-send-confirmed"
          toolCallId="assistant-demo-send-confirmed"
          disableConfirm={true}
        />
      </div>

      <div className="space-y-3">
        <MutedText>回复 — 等待中</MutedText>
        <ReplyEmailResult
          output={getAssistantReplyEmailOutput("pending")}
          chatMessageId="assistant-demo-reply-pending"
          toolCallId="assistant-demo-reply-pending"
          disableConfirm={true}
        />
      </div>

      <div className="space-y-3">
        <MutedText>回复 — 已确认</MutedText>
        <ReplyEmailResult
          output={getAssistantReplyEmailOutput("confirmed")}
          chatMessageId="assistant-demo-reply-confirmed"
          toolCallId="assistant-demo-reply-confirmed"
          disableConfirm={true}
        />
      </div>

      <div className="space-y-3">
        <MutedText>转发 — 等待中</MutedText>
        <ForwardEmailResult
          output={getAssistantForwardEmailOutput("pending")}
          chatMessageId="assistant-demo-forward-pending"
          toolCallId="assistant-demo-forward-pending"
          disableConfirm={true}
        />
      </div>

      <div className="space-y-3">
        <MutedText>转发 — 已确认</MutedText>
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
        from: "每日更新 <updates@example.com>",
        subject: "每日摘要",
        snippet: "你的摘要已就绪",
        date: "2026-03-09T10:00:00Z",
        isUnread: true,
      },
    ],
    [
      "thread-2",
      {
        messageId: "msg-2",
        from: "产品团队 <product@example.com>",
        subject: "发布说明",
        snippet: "今天发布了新变更",
        date: "2026-03-09T09:00:00Z",
        isUnread: false,
      },
    ],
    [
      "thread-3",
      {
        messageId: "msg-3",
        from: "支持团队 <support@example.com>",
        subject: "工单跟进",
        snippet: "询问你的请求进展",
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
          snippet: "询问你的请求进展",
          date: "2026-01-10T15:20:00.000Z",
          internalDate: `${Date.parse("2026-01-10T15:20:00.000Z")}`,
          historyId: "history-3",
          inline: [],
          headers: {
            from: "支持团队 <support@example.com>",
            to: "you@example.com",
            date: "2026-01-10T15:20:00.000Z",
            subject: "工单跟进",
          },
          textPlain:
            "你好，\n\n询问一下你的请求进展。待办事项是确认问题是否已解决。\n\n祝好，\n支持团队",
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
<email-detail threadid="thread-3">关注待办事项和当前状态。</email-detail>
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
        from: "每日更新 <updates@example.com>",
        snippet: "你的摘要已就绪",
        date: "2026-01-12T09:00:00.000Z",
        isUnread: true,
      },
      {
        messageId: "message-2",
        threadId: "thread-2",
        subject: "发布说明",
        from: "产品团队 <product@example.com>",
        snippet: "今天发布了新变更",
        date: "2026-01-11T18:30:00.000Z",
        isUnread: false,
      },
      {
        messageId: "message-3",
        threadId: "thread-3",
        subject: "工单跟进",
        from: "支持团队 <support@example.com>",
        snippet: "询问你的请求进展",
        date: "2026-01-10T15:20:00.000Z",
        isUnread: true,
      },
    ],
  };
}

function getAssistantSearchInboxErrorOutput() {
  return {
    queryUsed: "from:updates@example.com received>=2026-01-10",
    error: "无法搜索收件箱",
  };
}

function getAssistantReadEmailOutput() {
  return {
    messageId: "message-3",
    threadId: "thread-3",
    from: "支持团队 <support@example.com>",
    to: "you@example.com",
    subject: "工单跟进",
    content:
      "你好，\n\n询问一下你的请求进展。如果需要其他帮助，请告诉我们。\n\n祝好，\n支持团队",
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
      messageHtml: "<p>大家好，<br/>这是本周的更新。</p>",
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
      content: "谢谢跟进。这个问题现在已经解决了。",
    },
    reference: {
      messageId: "message-3",
      threadId: "thread-3",
      from: "支持团队 <support@example.com>",
      subject: "工单跟进",
    },
    ...(state === "confirmed"
      ? {
          confirmationResult: {
            actionType: "reply_email",
            confirmedAt: "2026-01-12T11:05:00.000Z",
            messageId: "message-reply-confirmed",
            threadId: "thread-3",
            subject: "回复：工单跟进",
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
      content: "转发此邮件供参考。",
    },
    reference: {
      messageId: "message-2",
      threadId: "thread-2",
      from: "产品团队 <product@example.com>",
      subject: "发布说明",
    },
    ...(state === "confirmed"
      ? {
          confirmationResult: {
            actionType: "forward_email",
            confirmedAt: "2026-01-12T11:20:00.000Z",
            messageId: "message-forward-confirmed",
            threadId: "thread-forward-confirmed",
            to: "finance@example.com",
            subject: "转发：发布说明",
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
