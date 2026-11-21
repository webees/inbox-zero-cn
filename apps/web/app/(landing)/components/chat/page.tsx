"use client";

import { Container } from "@/components/Container";
import { MutedText, TextLink } from "@/components/Typography";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Response } from "@/components/ai-elements/response";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import {
  CodeBlock,
  CodeBlockCopyButton,
} from "@/components/ai-elements/code-block";
import { Suggestions, Suggestion } from "@/components/ai-elements/suggestion";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Loader } from "@/components/ai-elements/loader";
import { PaperclipIcon, ImageIcon } from "lucide-react";

export default function ChatPage() {
  return (
    <Container>
      <div className="space-y-8 py-8">
        <h1>聊天组件</h1>

        <div>
          <TextLink href="/components">← 所有组件</TextLink>
        </div>

        {/* 消息 */}
        <Section title="消息（contained 变体）">
          <ChatFrame>
            <Message from="user">
              <MessageContent variant="contained">
                你能帮我清理收件箱吗？
              </MessageContent>
            </Message>
            <Message from="assistant">
              <MessageContent variant="contained">
                <Response>
                  当然！我可以帮你整理收件箱。让我搜索一下可以归档或分类的邮件。
                </Response>
              </MessageContent>
            </Message>
            <Message from="user">
              <MessageContent variant="contained">
                好的，请把上个月的所有邮件简报都归档。
              </MessageContent>
            </Message>
          </ChatFrame>
        </Section>

        <Section title="消息（flat 变体）">
          <ChatFrame>
            <Message from="user">
              <MessageContent variant="flat">我设置了哪些规则？</MessageContent>
            </Message>
            <Message from="assistant">
              <MessageContent variant="flat">
                <Response>
                  {
                    "你设置了 **3 条生效的规则**：\n\n1. **邮件简报处理** — 归档并给邮件简报打标签\n2. **重要邮件** — 标记来自你团队的紧急邮件\n3. **自动回复** — 当你不在办公室时发送回复"
                  }
                </Response>
              </MessageContent>
            </Message>
          </ChatFrame>
        </Section>

        {/* 推理 */}
        <Section title="推理（折叠）">
          <ChatFrame>
            <Message from="assistant">
              <MessageContent variant="flat">
                <Reasoning duration={4}>
                  <ReasoningTrigger />
                  <ReasoningContent>
                    用户想清理收件箱。我应该先搜索邮件简报和推广邮件，然后建议批量归档它们。我还要检查一下是否有任何可能冲突的现有规则。
                  </ReasoningContent>
                </Reasoning>
                <Response>
                  我找到了过去一个月里的 47
                  封邮件简报。你想让我把它们全部归档吗？
                </Response>
              </MessageContent>
            </Message>
          </ChatFrame>
        </Section>

        <Section title="推理（展开）">
          <ChatFrame>
            <Message from="assistant">
              <MessageContent variant="flat">
                <Reasoning duration={12} defaultOpen>
                  <ReasoningTrigger />
                  <ReasoningContent>
                    用户在询问自己的邮件规律。我需要分析他的收件箱，找出反复出现的发件人并对其进行分类。让我看看数量最多的发件人，并识别出邮件简报、推广邮件和重要联系人。我还应该考虑每个发件人的邮件频率。
                  </ReasoningContent>
                </Reasoning>
                <Response>
                  {
                    "根据你的收件箱分析，以下是你最主要的邮件分类：\n\n- **邮件简报**：120 封/月\n- **通知**：85 封/月\n- **直接消息**：45 封/月"
                  }
                </Response>
              </MessageContent>
            </Message>
          </ChatFrame>
        </Section>

        {/* 工具调用 */}
        <Section title="工具调用状态">
          <div className="space-y-4">
            <MutedText>等待中（输入流式传输）：</MutedText>
            <Tool>
              <ToolHeader
                title="search_inbox"
                type="tool-invocation"
                state="input-streaming"
              />
            </Tool>

            <MutedText>运行中（输入已就绪）：</MutedText>
            <Tool>
              <ToolHeader
                title="search_inbox"
                type="tool-invocation"
                state="input-available"
              />
              <ToolContent>
                <ToolInput
                  input={{
                    query: "newer_than:30d label:newsletter",
                    maxResults: 50,
                  }}
                />
              </ToolContent>
            </Tool>

            <MutedText>已请求批准：</MutedText>
            <Tool>
              <ToolHeader
                title="archive_emails"
                type="tool-invocation"
                state="approval-requested"
              />
              <ToolContent>
                <ToolInput
                  input={{
                    threadIds: ["thread-1", "thread-2", "thread-3"],
                    action: "archive",
                  }}
                />
              </ToolContent>
            </Tool>

            <MutedText>已完成：</MutedText>
            <Tool>
              <ToolHeader
                title="search_inbox"
                type="tool-invocation"
                state="output-available"
              />
              <ToolContent>
                <ToolInput
                  input={{
                    query: "newer_than:7d in:inbox",
                    maxResults: 10,
                  }}
                />
                <ToolOutput
                  output={{
                    totalResults: 3,
                    messages: [
                      {
                        from: "updates@github.com",
                        subject: "请求评审 PR",
                      },
                      {
                        from: "team@company.com",
                        subject: "每周站会记录",
                      },
                      {
                        from: "news@techcrunch.com",
                        subject: "每日邮件摘要",
                      },
                    ],
                  }}
                  errorText={undefined}
                />
              </ToolContent>
            </Tool>

            <MutedText>错误：</MutedText>
            <Tool>
              <ToolHeader
                title="send_email"
                type="tool-invocation"
                state="output-error"
              />
              <ToolContent>
                <ToolInput
                  input={{
                    to: "user@example.com",
                    subject: "跟进",
                    body: "你好，只是想跟进一下我们的对话。",
                  }}
                />
                <ToolOutput
                  output={undefined}
                  errorText="发送邮件失败：超出速率限制。请稍后重试。"
                />
              </ToolContent>
            </Tool>

            <MutedText>已拒绝：</MutedText>
            <Tool>
              <ToolHeader
                title="delete_emails"
                type="tool-invocation"
                state="output-denied"
              />
              <ToolContent>
                <ToolInput
                  input={{
                    threadIds: ["thread-1", "thread-2"],
                    permanent: true,
                  }}
                />
              </ToolContent>
            </Tool>
          </div>
        </Section>

        {/* 带工具调用的完整对话 */}
        <Section title="带工具调用的完整对话">
          <ChatFrame>
            <Message from="user">
              <MessageContent variant="flat">
                搜索我本周来自 GitHub 的邮件。
              </MessageContent>
            </Message>
            <Message from="assistant">
              <MessageContent variant="flat">
                <Tool>
                  <ToolHeader
                    title="search_inbox"
                    type="tool-invocation"
                    state="output-available"
                  />
                  <ToolContent>
                    <ToolInput
                      input={{
                        query: "from:github.com newer_than:7d",
                        maxResults: 20,
                      }}
                    />
                    <ToolOutput
                      output={{
                        totalResults: 5,
                        messages: [
                          {
                            from: "notifications@github.com",
                            subject: "PR #142 已合并",
                          },
                          {
                            from: "notifications@github.com",
                            subject: "Issue #87 已分配给你",
                          },
                        ],
                      }}
                      errorText={undefined}
                    />
                  </ToolContent>
                </Tool>
                <Response>
                  {
                    "我找到了本周来自 GitHub 的 **5 封邮件**。以下是要点：\n\n1. **PR #142 已合并** — 你的拉取请求已被合并\n2. **Issue #87 已分配给你** — 有一个新 issue 需要你处理\n\n你想让我对这些邮件做些什么吗？"
                  }
                </Response>
              </MessageContent>
            </Message>
          </ChatFrame>
        </Section>

        {/* 带推理 + 工具调用的对话 */}
        <Section title="带推理 + 工具调用的对话">
          <ChatFrame>
            <Message from="user">
              <MessageContent variant="flat">
                帮我退订那些我从来不看的邮件简报。
              </MessageContent>
            </Message>
            <Message from="assistant">
              <MessageContent variant="flat">
                <Reasoning duration={6}>
                  <ReasoningTrigger />
                  <ReasoningContent>
                    用户想退订他从来不看的邮件简报。我应该先搜索邮件简报，找出互动率低的那些。我会看看打开率，以及哪些是在未被阅读的情况下被归档的。
                  </ReasoningContent>
                </Reasoning>
                <Tool>
                  <ToolHeader
                    title="search_inbox"
                    type="tool-invocation"
                    state="output-available"
                  />
                  <ToolContent>
                    <ToolInput
                      input={{
                        query: "label:newsletter is:unread older_than:30d",
                        maxResults: 100,
                      }}
                    />
                    <ToolOutput
                      output={{
                        totalResults: 23,
                        uniqueSenders: 8,
                        topUnreadSenders: [
                          {
                            sender: "marketing@store.com",
                            unreadCount: 12,
                          },
                          {
                            sender: "weekly@digest.io",
                            unreadCount: 8,
                          },
                          {
                            sender: "deals@shop.com",
                            unreadCount: 3,
                          },
                        ],
                      }}
                      errorText={undefined}
                    />
                  </ToolContent>
                </Tool>
                <Response>
                  {
                    "我找到了来自 8 个发件人的 **23 封未读邮件简报**。以下是你似乎从来不看的那些：\n\n| 发件人 | 未读数 |\n|---|---|\n| marketing@store.com | 12 |\n| weekly@digest.io | 8 |\n| deals@shop.com | 3 |\n\n你想退订其中任何一封吗？"
                  }
                </Response>
              </MessageContent>
            </Message>
          </ChatFrame>
        </Section>

        {/* Markdown 回复 */}
        <Section title="回复（Markdown）">
          <ChatFrame>
            <Message from="assistant">
              <MessageContent variant="flat">
                <Response>
                  {
                    "以下是你的收件箱规则摘要：\n\n## 生效的规则\n\n1. **邮件简报处理**\n   - 触发条件：`from:*@substack.com`\n   - 操作：归档并标记为“邮件简报”\n\n2. **紧急邮件**\n   - 触发条件：主题包含“urgent”或“ASAP”\n   - 操作：加星标并移到顶部\n\n> **提示：** 你可以用 AND/OR 运算符组合多个条件，实现更精确的筛选。\n\n### 快速统计\n- 本月规则处理了 **1,247** 封邮件\n- 准确率 **89%**\n- 最活跃的规则：邮件简报处理（523 次匹配）"
                  }
                </Response>
              </MessageContent>
            </Message>
          </ChatFrame>
        </Section>

        {/* 代码块 */}
        <Section title="代码块">
          <div className="space-y-4">
            <MutedText>JSON 输出：</MutedText>
            <CodeBlock
              code={JSON.stringify(
                {
                  rule: "Newsletter Handler",
                  conditions: {
                    from: "*@substack.com",
                    operator: "OR",
                  },
                  actions: ["archive", "label:Newsletter"],
                  stats: { matched: 523, lastRun: "2026-03-05T10:00:00Z" },
                },
                null,
                2,
              )}
              language="json"
            >
              <CodeBlockCopyButton />
            </CodeBlock>

            <MutedText>TypeScript：</MutedText>
            <CodeBlock
              code={`async function processEmails(rules: Rule[]) {
  const inbox = await searchInbox({ query: "in:inbox" });

  for (const email of inbox.messages) {
    const matchingRule = rules.find((r) => r.matches(email));
    if (matchingRule) {
      await matchingRule.apply(email);
    }
  }
}`}
              language="typescript"
              showLineNumbers
            >
              <CodeBlockCopyButton />
            </CodeBlock>
          </div>
        </Section>

        {/* 建议 */}
        <Section title="建议">
          <Suggestions>
            <Suggestion suggestion="帮我处理我的收件箱" />
            <Suggestion suggestion="清理邮件简报" />
            <Suggestion suggestion="创建一条新规则" />
            <Suggestion suggestion="显示我的邮件统计" />
            <Suggestion suggestion="自动归档旧邮件" />
          </Suggestions>
        </Section>

        {/* 提示输入框 */}
        <Section title="提示输入框">
          <div className="space-y-4">
            <MutedText>默认（空闲）：</MutedText>
            <PromptInput onSubmit={(e) => e.preventDefault()}>
              <PromptInputTextarea disabled />
              <PromptInputToolbar>
                <PromptInputTools>
                  <PromptInputButton>
                    <PaperclipIcon className="size-4" />
                  </PromptInputButton>
                  <PromptInputButton>
                    <ImageIcon className="size-4" />
                  </PromptInputButton>
                </PromptInputTools>
                <PromptInputSubmit status="ready" />
              </PromptInputToolbar>
            </PromptInput>

            <MutedText>已提交（加载中）：</MutedText>
            <PromptInput onSubmit={(e) => e.preventDefault()}>
              <PromptInputTextarea value="归档上个月的所有邮件简报" disabled />
              <PromptInputToolbar>
                <PromptInputTools>
                  <PromptInputButton>
                    <PaperclipIcon className="size-4" />
                  </PromptInputButton>
                </PromptInputTools>
                <PromptInputSubmit status="submitted" />
              </PromptInputToolbar>
            </PromptInput>

            <MutedText>流式传输：</MutedText>
            <PromptInput onSubmit={(e) => e.preventDefault()}>
              <PromptInputTextarea disabled />
              <PromptInputToolbar>
                <PromptInputTools>
                  <PromptInputButton>
                    <PaperclipIcon className="size-4" />
                  </PromptInputButton>
                </PromptInputTools>
                <PromptInputSubmit status="streaming" />
              </PromptInputToolbar>
            </PromptInput>

            <MutedText>错误：</MutedText>
            <PromptInput onSubmit={(e) => e.preventDefault()}>
              <PromptInputTextarea disabled />
              <PromptInputToolbar>
                <PromptInputTools>
                  <PromptInputButton>
                    <PaperclipIcon className="size-4" />
                  </PromptInputButton>
                </PromptInputTools>
                <PromptInputSubmit status="error" />
              </PromptInputToolbar>
            </PromptInput>
          </div>
        </Section>

        {/* 微光效果与加载器 */}
        <Section title="微光效果与加载器">
          <div className="space-y-4">
            <MutedText>微光文本：</MutedText>
            <Shimmer className="text-sm">正在思考你的请求…</Shimmer>
            <Shimmer className="text-base">
              正在你的收件箱中搜索匹配的邮件…
            </Shimmer>
            <Shimmer as="span" className="text-lg font-semibold">
              正在处理 47 封邮件
            </Shimmer>

            <MutedText>加载器：</MutedText>
            <div className="flex items-center gap-4">
              <Loader size={16} />
              <Loader size={24} />
              <Loader size={32} />
            </div>
          </div>
        </Section>

        {/* 空状态 */}
        <Section title="对话空状态">
          <div className="h-[200px] rounded-lg border">
            <ConversationEmptyState
              title="开始对话"
              description="关于你的收件箱，随便问我"
            />
          </div>
        </Section>

        {/* 完整聊天布局 */}
        <Section title="完整聊天布局">
          <div className="flex h-[600px] flex-col rounded-lg border">
            <Conversation>
              <ConversationContent>
                <Message from="user">
                  <MessageContent variant="flat">
                    你能给我看看本周收件箱活动的摘要吗？
                  </MessageContent>
                </Message>
                <Message from="assistant">
                  <MessageContent variant="flat">
                    <Reasoning duration={3}>
                      <ReasoningTrigger />
                      <ReasoningContent>
                        让我调出本周的收件箱活动。我需要搜索所有邮件，并按类型和发件人对它们进行分类。
                      </ReasoningContent>
                    </Reasoning>
                    <Tool>
                      <ToolHeader
                        title="search_inbox"
                        type="tool-invocation"
                        state="output-available"
                      />
                      <ToolContent>
                        <ToolInput
                          input={{
                            query: "newer_than:7d",
                            maxResults: 100,
                          }}
                        />
                        <ToolOutput
                          output={{
                            total: 67,
                            unread: 12,
                            categories: {
                              newsletters: 23,
                              notifications: 18,
                              direct: 15,
                              promotions: 11,
                            },
                          }}
                          errorText={undefined}
                        />
                      </ToolContent>
                    </Tool>
                    <Response>
                      {
                        "这是你本周的收件箱摘要：\n\n- **共 67 封邮件**（12 封未读）\n- 邮件简报：23\n- 通知：18\n- 直接消息：15\n- 推广邮件：11\n\n你想让我帮你清理其中某些分类吗？"
                      }
                    </Response>
                  </MessageContent>
                </Message>
                <Message from="user">
                  <MessageContent variant="flat">
                    好的，请把所有推广邮件都归档。
                  </MessageContent>
                </Message>
                <Message from="assistant">
                  <MessageContent variant="flat">
                    <Tool>
                      <ToolHeader
                        title="archive_emails"
                        type="tool-invocation"
                        state="approval-requested"
                      />
                      <ToolContent>
                        <ToolInput
                          input={{
                            action: "archive",
                            filter: "category:promotions newer_than:7d",
                            count: 11,
                          }}
                        />
                      </ToolContent>
                    </Tool>
                    <Response>
                      {"我已准备好归档 **11 封推广邮件**。请确认后继续。"}
                    </Response>
                  </MessageContent>
                </Message>
              </ConversationContent>
            </Conversation>
            <div className="border-t p-3">
              <PromptInput onSubmit={(e) => e.preventDefault()}>
                <PromptInputTextarea disabled />
                <PromptInputToolbar>
                  <PromptInputTools>
                    <PromptInputButton>
                      <PaperclipIcon className="size-4" />
                    </PromptInputButton>
                  </PromptInputTools>
                  <PromptInputSubmit status="ready" />
                </PromptInputToolbar>
              </PromptInput>
            </div>
          </div>
        </Section>
      </div>
    </Container>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="underline">{title}</div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function ChatFrame({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1 rounded-lg border p-4">{children}</div>;
}
