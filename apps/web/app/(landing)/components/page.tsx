"use client";

import { SparklesIcon } from "lucide-react";
import {
  Card,
  CardBasic,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Container } from "@/components/Container";
import {
  PageHeading,
  PageSubHeading,
  SectionDescription,
  SectionHeader,
  MessageText,
  TypographyP,
  TypographyH3,
  TypographyH4,
  TextLink,
  MutedText,
} from "@/components/Typography";
import { Button } from "@/components/Button";
import { Button as ShadButton } from "@/components/ui/button";
import { Badge } from "@/components/Badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { ActionCard } from "@/components/ui/card";
import { AlertBasic } from "@/components/Alert";
import { Notice } from "@/components/Notice";
import { TestErrorButton } from "@/app/(landing)/components/TestError";
import { TestActionButton } from "@/app/(landing)/components/TestAction";
import {
  MultiSelectFilter,
  useMultiSelectFilter,
} from "@/components/MultiSelectFilter";
import { TagInput } from "@/components/TagInput";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Select as NativeSelect } from "@/components/Select";
import { TooltipExplanation } from "@/components/TooltipExplanation";
import { Suspense, useState } from "react";
import { PremiumAiAssistantAlert } from "@/components/PremiumAlert";
import { ActionType, ExecutedRuleStatus } from "@/generated/prisma/enums";
import type { Rule } from "@/generated/prisma/client";
import { SettingCard } from "@/components/SettingCard";
import { ListCard } from "@/components/ListCard";
import { RadioCardGroup } from "@/components/RadioCardGroup";
import { Toggle } from "@/components/Toggle";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { IconCircle } from "@/app/(app)/[emailAccountId]/onboarding/IconCircle";
import { isValidEmail } from "@/utils/email";
import { EmailAccountPreviewProvider } from "@/providers/EmailAccountProvider";
import { ActionBadges } from "@/app/(app)/[emailAccountId]/assistant/Rules";
import { DismissibleVideoCard } from "@/components/VideoCard";
import { PremiumExpiredCardContent } from "@/components/PremiumCard";
import { AnnouncementDialogDemo } from "@/components/feature-announcements/AnnouncementDialogDemo";
import {
  ResultsDisplay,
  ResultDisplayContent,
} from "@/app/(app)/[emailAccountId]/assistant/ResultDisplay";
import {
  ActivityLog,
  type ActivityLogEntry,
} from "@/app/(app)/[emailAccountId]/assistant/BulkProcessActivityLog";

export const maxDuration = 3;

export default function Components() {
  return (
    <EmailAccountPreviewProvider>
      <ComponentsDemo />
    </EmailAccountPreviewProvider>
  );
}

function ComponentsDemo() {
  const { selectedValues, setSelectedValues } = useMultiSelectFilter([
    "alerts",
  ]);
  const [basicTags, setBasicTags] = useState<string[]>(["react", "typescript"]);
  const [emailTags, setEmailTags] = useState<string[]>([
    "alice@example.com",
    "bob@example.com",
  ]);
  const [joinRule, setJoinRule] = useState("all");
  const [notifyByEmail, setNotifyByEmail] = useState(true);
  const [demoCategory, setDemoCategory] = useState("newsletters");
  return (
    <Container>
      <div className="space-y-8 py-8">
        <h1>一个展示我们所使用组件的 Storybook 风格页面。</h1>

        <div className="space-y-1">
          <div>
            <TextLink href="/components/tools">助手工具 →</TextLink>
          </div>
          <div>
            <TextLink href="/components/chat">聊天组件 →</TextLink>
          </div>
          <div>
            <TextLink href="/components/slack">Slack 组件 →</TextLink>
          </div>
          <div>
            <TextLink href="/components/onboarding">引导流程组件 →</TextLink>
          </div>
        </div>

        <div className="space-y-6">
          <div className="underline">排版</div>
          <PageHeading>PageHeading</PageHeading>
          <TypographyH3>TypographyH3</TypographyH3>
          <TypographyH4>TypographyH4</TypographyH4>
          <SectionHeader>SectionHeader</SectionHeader>
          <PageSubHeading>PageSubHeading</PageSubHeading>
          <SectionDescription>SectionDescription</SectionDescription>
          <MessageText>MessageText</MessageText>
          <TypographyP>TypographyP</TypographyP>
          <MutedText>MutedText</MutedText>
          <TextLink href="#">TextLink</TextLink>
        </div>

        <div className="space-y-6">
          <div className="underline">卡片</div>
          <CardBasic>这是一个基础卡片。</CardBasic>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>默认卡片</CardTitle>
                <CardDescription>此卡片使用默认尺寸。</CardDescription>
              </CardHeader>
              <CardContent>
                <p>默认卡片有更大的内边距和文字，以便在标准布局中更易阅读。</p>
              </CardContent>
              <CardFooter>
                <ShadButton variant="outline" className="w-full">
                  操作
                </ShadButton>
              </CardFooter>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>小卡片</CardTitle>
                <CardDescription>此卡片使用小尺寸变体。</CardDescription>
              </CardHeader>
              <CardContent>
                <p>
                  卡片组件支持 size 属性，可设置为 &quot;sm&quot;
                  以获得更紧凑的外观。
                </p>
              </CardContent>
              <CardFooter>
                <ShadButton variant="outline" size="sm" className="w-full">
                  操作
                </ShadButton>
              </CardFooter>
            </Card>
          </div>

          <div className="space-y-4">
            <ActionCard
              icon={<SparklesIcon className="size-5" />}
              title="操作卡片（绿色）"
              description="这是 ActionCard 组件的默认绿色变体。"
              action={<ShadButton variant="primaryBlack">点我</ShadButton>}
            />
            <ActionCard
              variant="blue"
              icon={<SparklesIcon className="size-5" />}
              title="操作卡片（蓝色）"
              description="这是 ActionCard 组件的蓝色变体。"
              action={<ShadButton variant="primaryBlack">点我</ShadButton>}
            />
            <ActionCard
              variant="destructive"
              icon={<SparklesIcon className="size-5" />}
              title="操作卡片（危险操作）"
              description="这是 ActionCard 组件的危险操作变体。"
              action={<ShadButton variant="primaryBlack">点我</ShadButton>}
            />
          </div>
        </div>

        <div className="space-y-6">
          <div className="underline">按钮</div>
          <div className="flex flex-wrap gap-2">
            <Button size="xs">按钮 XS</Button>
            <Button size="sm">按钮 SM</Button>
            <Button size="md">按钮 MD</Button>
            <Button size="lg">按钮 LG</Button>
            <Button size="xl">按钮 XL</Button>
            <Button size="2xl">按钮 2XL</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button color="red">按钮 红色</Button>
            <Button color="white">按钮 白色</Button>
            <Button color="transparent">按钮 透明</Button>
            <Button loading>按钮 加载中</Button>
            <Button disabled>按钮 禁用</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <ShadButton variant="default">ShadButton 默认</ShadButton>
            <ShadButton variant="secondary">ShadButton 次要</ShadButton>
            <ShadButton variant="outline">ShadButton 描边</ShadButton>
            <ShadButton variant="outline" loading>
              ShadButton 加载中
            </ShadButton>
            <ShadButton variant="ghost">ShadButton 幽灵</ShadButton>
            <ShadButton variant="destructive">ShadButton 危险操作</ShadButton>
            <ShadButton variant="link">ShadButton 链接</ShadButton>
            <ShadButton variant="green">ShadButton 绿色</ShadButton>
            <ShadButton variant="red">ShadButton 红色</ShadButton>
            <ShadButton variant="blue">ShadButton 蓝色</ShadButton>
            <ShadButton>ShadButton 主蓝色</ShadButton>
          </div>
          <div className="flex flex-wrap gap-2">
            <ShadButton size="xs">ShadButton XS</ShadButton>
            <ShadButton size="sm">ShadButton SM</ShadButton>
            <ShadButton size="lg">ShadButton LG</ShadButton>
            <ShadButton size="icon">
              <SparklesIcon className="size-4" />
            </ShadButton>
          </div>
        </div>

        <div className="space-y-6">
          <div className="underline">徽章</div>
          <div className="flex flex-wrap gap-2">
            <Badge color="blue">蓝色</Badge>
            <Badge color="gray">灰色</Badge>
            <Badge color="green">绿色</Badge>
            <Badge color="indigo">靛蓝</Badge>
            <Badge color="orange">橙色</Badge>
            <Badge color="pink">粉色</Badge>
            <Badge color="purple">紫色</Badge>
            <Badge color="red">红色</Badge>
            <Badge color="yellow">黄色</Badge>
          </div>
        </div>

        <div>
          <div className="underline">标签页</div>
          <div className="mt-4">
            <Suspense>
              <Tabs defaultValue="account" className="w-[400px]">
                <TabsList>
                  <TabsTrigger value="account">账号</TabsTrigger>
                  <TabsTrigger value="password">密码</TabsTrigger>
                </TabsList>
                <TabsContent value="account">账号内容</TabsContent>
                <TabsContent value="password">密码内容</TabsContent>
              </Tabs>
            </Suspense>
          </div>
        </div>

        <div>
          <div className="underline">警告提示</div>
          <div className="mt-4 space-y-2">
            <AlertBasic
              title="警告标题 默认"
              description="警告描述"
              variant="default"
            />
            <AlertBasic
              title="警告标题 成功"
              description="警告描述"
              variant="success"
            />
            <AlertBasic
              title="警告标题 危险操作"
              description="警告描述"
              variant="destructive"
            />
            <AlertBasic
              title="警告标题 蓝色"
              description="警告描述"
              variant="blue"
            />
          </div>
        </div>

        <div>
          <div className="underline">通知</div>
          <div className="mt-4 space-y-2">
            <Notice variant="info">
              <strong>信息：</strong> 这是一条带有一些有用背景的信息通知。
            </Notice>
            <Notice variant="warning">
              <strong>警告：</strong> 执行此操作时请谨慎。
            </Notice>
            <Notice variant="success">
              <strong>成功：</strong> 你的更改已成功保存！
            </Notice>
            <Notice variant="error">
              <strong>错误：</strong> 出了点问题。请重试。
            </Notice>
          </div>
        </div>

        <div>
          <div className="underline">TooltipExplanation</div>
          <div className="mt-4 flex flex-col gap-2">
            <TooltipExplanation size="sm" text="小号说明提示" />
            <TooltipExplanation size="md" text="中号说明提示" />
          </div>
        </div>

        <div>
          <div className="underline">高级版提示</div>
          <div className="mt-4 space-y-4">
            <div>
              <MutedText className="mb-2">
                基础套餐（需要升级到 Business）：
              </MutedText>
              <PremiumAiAssistantAlert
                showSetApiKey={false}
                tier={"BASIC_MONTHLY"}
              />
            </div>
            <div>
              <MutedText className="mb-2">
                专业套餐（需要 API 密钥）：
              </MutedText>
              <PremiumAiAssistantAlert
                showSetApiKey={true}
                tier={"PRO_MONTHLY"}
              />
            </div>
            <div>
              <MutedText className="mb-2">免费套餐（需要升级）：</MutedText>
              <PremiumAiAssistantAlert showSetApiKey={false} tier={null} />
            </div>
          </div>
        </div>

        <div>
          <div className="underline">DismissibleVideoCard</div>
          <div className="mt-4">
            <DismissibleVideoCard
              icon={<SparklesIcon className="h-5 w-5" />}
              title="AI 助手入门"
              description={"了解如何使用 AI 助手自动打标签、归档等。"}
              muxPlaybackId="TYo3SIMdhg008x022H79400CxeRSiB6mLyuwHx8Szc00Rec"
              storageKey={`video-dismissible-${Date.now()}`}
            />
          </div>
        </div>

        <div>
          <div className="underline">AnnouncementDialog</div>
          <div className="mt-4">
            <AnnouncementDialogDemo />
          </div>
        </div>

        <div>
          <div className="underline">IconCircle</div>
          <div className="mt-4">
            <IconCircle size="md" color="blue" Icon={SparklesIcon} />
          </div>
        </div>

        <div>
          <div className="underline">ActionBadges</div>
          <div className="mt-4">
            <ActionBadges
              actions={[
                {
                  type: ActionType.LABEL,
                  label: "标签",
                  id: "label",
                },
                {
                  type: ActionType.MOVE_FOLDER,
                  label: "移动到文件夹",
                  id: "move_folder",
                  folderName: "营销",
                },
                {
                  type: ActionType.ARCHIVE,
                  label: "归档",
                  id: "archive",
                },
                {
                  type: ActionType.DRAFT_EMAIL,
                  label: "草稿",
                  id: "draft",
                },
                {
                  type: ActionType.DRAFT_EMAIL,
                  label: "草稿",
                  id: "draft-with-content",
                  content: "你好，我想和你讨论一下这个项目。",
                },
                {
                  type: ActionType.REPLY,
                  label: "回复",
                  id: "reply",
                },
                {
                  type: ActionType.SEND_EMAIL,
                  label: "发送",
                  id: "send",
                },
                {
                  type: ActionType.SEND_EMAIL,
                  label: "发送",
                  id: "send-with-to",
                  to: "test@example.com",
                },
                {
                  type: ActionType.FORWARD,
                  label: "转发",
                  id: "forward",
                },
                {
                  type: ActionType.FORWARD,
                  label: "转发",
                  id: "forward-with-to",
                  to: "test@example.com",
                },
                {
                  type: ActionType.MARK_SPAM,
                  label: "标记为垃圾邮件",
                  id: "mark_spam",
                },
                {
                  type: ActionType.MARK_READ,
                  label: "标记为已读",
                  id: "mark_read",
                },
                {
                  type: ActionType.CALL_WEBHOOK,
                  label: "调用 Webhook",
                  id: "call_webhook",
                },
                {
                  type: ActionType.DIGEST,
                  label: "邮件摘要",
                  id: "digest",
                },
                {
                  type: ActionType.NOTIFY_SENDER,
                  label: "通知发件人",
                  id: "notify_sender",
                },
              ]}
              provider="gmail"
              labels={[{ id: "label", name: "标签" }]}
            />
          </div>
        </div>

        <div>
          <div className="underline">ResultsDisplay</div>
          <div className="mt-4">
            <ResultsDisplay
              results={[
                {
                  createdAt: new Date("2025-01-01"),
                  actionItems: [
                    {
                      type: ActionType.LABEL,
                      label: "标签",
                      id: "label",
                    },
                  ],
                  reason: "测试原因",
                  rule: getRule(),
                  status: ExecutedRuleStatus.APPLIED,
                },
              ]}
            />

            <div className="mt-8">
              <MutedText className="mb-2">包含多批次的复杂示例：</MutedText>
              <ResultsDisplay
                results={[
                  // 批次 1（最新）：2 条规则
                  {
                    createdAt: new Date("2025-01-05T10:00:00"),
                    actionItems: [
                      {
                        type: ActionType.LABEL,
                        label: "紧急",
                        id: "label1",
                      },
                    ],
                    reason: "匹配紧急条件",
                    rule: getRuleWithName("紧急处理"),
                    status: ExecutedRuleStatus.APPLIED,
                  },
                  {
                    createdAt: new Date("2025-01-05T10:00:00"),
                    actionItems: [
                      {
                        type: ActionType.ARCHIVE,
                        id: "archive1",
                      },
                    ],
                    reason: "匹配归档条件",
                    rule: getRuleWithName("自动归档"),
                    status: ExecutedRuleStatus.APPLIED,
                  },
                  // 批次 2（较早）：2 条规则 - 将显示 “Previous:”
                  {
                    createdAt: new Date("2025-01-04T10:00:00"),
                    actionItems: [
                      {
                        type: ActionType.LABEL,
                        label: "重要",
                        id: "label2",
                      },
                    ],
                    reason: "匹配重要条件",
                    rule: getRuleWithName("重要筛选"),
                    status: ExecutedRuleStatus.APPLIED,
                  },
                  {
                    createdAt: new Date("2025-01-04T10:00:00"),
                    actionItems: [
                      {
                        type: ActionType.MARK_READ,
                        id: "mark_read1",
                      },
                    ],
                    reason: "匹配已读条件",
                    rule: getRuleWithName("标记为已读"),
                    status: ExecutedRuleStatus.APPLIED,
                  },
                  // 批次 3：3 条规则
                  {
                    createdAt: new Date("2025-01-03T10:00:00"),
                    actionItems: [
                      {
                        type: ActionType.LABEL,
                        label: "邮件简报",
                        id: "label3",
                      },
                    ],
                    reason: "匹配邮件简报条件",
                    rule: getRuleWithName("邮件简报处理"),
                    status: ExecutedRuleStatus.APPLIED,
                  },
                  {
                    createdAt: new Date("2025-01-03T10:00:00"),
                    actionItems: [
                      {
                        type: ActionType.MOVE_FOLDER,
                        folderName: "营销",
                        id: "move1",
                      },
                    ],
                    reason: "匹配营销条件",
                    rule: getRuleWithName("营销文件夹"),
                    status: ExecutedRuleStatus.APPLIED,
                  },
                  {
                    createdAt: new Date("2025-01-03T10:00:00"),
                    actionItems: [
                      {
                        type: ActionType.DIGEST,
                        id: "digest1",
                      },
                    ],
                    reason: "匹配邮件摘要条件",
                    rule: getRuleWithName("每周邮件摘要"),
                    status: ExecutedRuleStatus.APPLIED,
                  },
                  // 批次 4：1 条规则
                  {
                    createdAt: new Date("2025-01-02T10:00:00"),
                    actionItems: [
                      {
                        type: ActionType.LABEL,
                        label: "跟进",
                        id: "label4",
                      },
                    ],
                    reason: "匹配跟进条件",
                    rule: getRuleWithName("跟进追踪"),
                    status: ExecutedRuleStatus.APPLIED,
                  },
                ]}
              />
            </div>

            <div className="p-4 border border-border rounded mt-4">
              <ResultDisplayContent
                result={{
                  createdAt: new Date("2025-01-01"),
                  actionItems: [
                    {
                      type: ActionType.LABEL,
                      label: "标签",
                      id: "label",
                    },
                  ],
                  reason: "测试原因",
                  rule: getRule(),
                  status: ExecutedRuleStatus.APPLIED,
                }}
              />
            </div>

            <div className="p-4 border border-border rounded mt-4">
              <ResultDisplayContent
                result={{
                  createdAt: new Date("2025-01-01"),
                  actionItems: [
                    {
                      type: ActionType.LABEL,
                      label: "待回复",
                      id: "label",
                    },
                    {
                      type: ActionType.DRAFT_EMAIL,
                      subject: "回复：测试主题",
                      content: "你好，我想和你讨论一下这个项目。",
                      to: "test@example.com",
                      id: "draft_email",
                    },
                  ],
                  reason: "测试原因",
                  rule: {
                    ...getRule(),
                    from: "team@company.com",
                    instructions: "需要立即处理的紧急请求",
                    conditionalOperator: "AND",
                  },
                  status: ExecutedRuleStatus.APPLIED,
                }}
              />
            </div>

            <div className="p-4 border border-border rounded mt-4">
              <ResultDisplayContent
                result={{
                  createdAt: new Date("2025-01-01"),
                  actionItems: [
                    {
                      type: ActionType.LABEL,
                      label: "重要",
                      id: "label",
                    },
                  ],
                  reason: "测试原因",
                  rule: {
                    ...getRule(),
                    from: "notifications@github.com",
                    body: "提到了你",
                    instructions: "需要我反馈的拉取请求评审",
                    conditionalOperator: "OR",
                  },
                  status: ExecutedRuleStatus.APPLIED,
                }}
              />
            </div>

            <div className="p-4 border border-border rounded mt-4">
              <ResultDisplayContent
                result={{
                  createdAt: new Date("2025-01-01"),
                  reason:
                    "这封邮件看起来是自动发送的，并且是现有会话的一部分，因此没有选中任何符合条件的规则。",
                  status: ExecutedRuleStatus.SKIPPED,
                  selectionMetadata: {
                    isThread: true,
                    skippedThreadRuleNames: ["通知", "邮件简报", "营销"],
                    continuedThreadRuleNames: [],
                    learnedPatternExcludedRules: [],
                    filteredConversationRuleNames: [],
                    conversationFilterReason: undefined,
                    remainingAiRuleNames: [],
                  },
                }}
              />
            </div>

            <div className="p-4 border border-border rounded mt-4">
              <ResultDisplayContent
                result={{
                  createdAt: new Date("2025-01-01"),
                  reason:
                    "在 AI 匹配之前，一条学习到的排除项移除了预期的系统规则。",
                  status: ExecutedRuleStatus.SKIPPED,
                  selectionMetadata: {
                    isThread: false,
                    skippedThreadRuleNames: [],
                    continuedThreadRuleNames: [],
                    learnedPatternExcludedRules: [
                      {
                        ruleId: "notification-rule",
                        ruleName: "通知",
                        groupId: "notification-group",
                        groupName: "通知",
                        itemType: "FROM",
                        itemValue: "updates@example.com",
                      },
                    ],
                    filteredConversationRuleNames: [],
                    conversationFilterReason: undefined,
                    remainingAiRuleNames: [
                      "日历",
                      "收据",
                      "营销",
                      "邮件简报",
                      "会话",
                    ],
                  },
                }}
              />
            </div>
          </div>
        </div>

        <div>
          <div className="underline">ActivityLog</div>
          <div className="mt-4 space-y-4">
            <MutedText>默认，混合状态：</MutedText>
            <ActivityLog
              entries={getActivityLogEntries()}
              processingCount={2}
            />

            <MutedText>暂停状态：</MutedText>
            <ActivityLog
              entries={getActivityLogEntries()}
              processingCount={2}
              paused={true}
            />

            <MutedText>长文本截断测试：</MutedText>
            <ActivityLog
              entries={[
                {
                  id: "long-1",
                  from: '"应该被截断的超长发件人名称" <extremely-long-email-address-that-goes-on-forever@really-long-domain-name.com>',
                  subject:
                    "这是一条极长的主题行，在活动日志组件中显示时应该被正确截断——它只是不停地延续下去，内容越来越多",
                  status: "completed",
                  ruleName: "邮件简报",
                },
                {
                  id: "long-2",
                  from: "简短 <short@test.com>",
                  subject: "简短主题",
                  status: "processing",
                },
              ]}
              processingCount={1}
            />

            <MutedText>全部完成：</MutedText>
            <ActivityLog
              entries={[
                {
                  id: "done-1",
                  from: "Alice <alice@example.com>",
                  subject: "会议记录",
                  status: "completed",
                  ruleName: "工作",
                },
                {
                  id: "done-2",
                  from: "Bob <bob@example.com>",
                  subject: "项目更新",
                  status: "completed",
                  ruleName: "仅供参考",
                },
                {
                  id: "done-3",
                  from: "邮件简报 <news@company.com>",
                  subject: "每周邮件摘要",
                  status: "completed",
                },
              ]}
              processingCount={0}
            />
          </div>
        </div>

        <div>
          <div className="underline">MultiSelectFilter</div>
          <div className="mt-4">
            <MultiSelectFilter
              title="分类"
              options={[
                { label: "收据", value: "receipts" },
                { label: "邮件简报", value: "newsletters" },
                { label: "更新", value: "updates" },
                { label: "提醒", value: "alerts" },
              ]}
              selectedValues={selectedValues}
              setSelectedValues={setSelectedValues}
            />
          </div>
        </div>

        <div>
          <div className="underline">表单字段</div>
          <div className="mt-4 max-w-md space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="demo-input">输入框</Label>
              <Input id="demo-input" placeholder="name@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-input-disabled">输入框，禁用</Label>
              <Input id="demo-input-disabled" placeholder="已禁用" disabled />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-textarea">多行文本</Label>
              <Textarea id="demo-textarea" placeholder="描述这里应该放什么…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-select">下拉选择</Label>
              <Select value={demoCategory} onValueChange={setDemoCategory}>
                <SelectTrigger id="demo-select">
                  <SelectValue placeholder="选择一个分类" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="receipts">收据</SelectItem>
                  <SelectItem value="newsletters">邮件简报</SelectItem>
                  <SelectItem value="updates">更新</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <NativeSelect
              name="demo-native-select"
              label="下拉选择，原生"
              options={[
                { label: "收据", value: "receipts" },
                { label: "邮件简报", value: "newsletters" },
                { label: "更新", value: "updates" },
              ]}
            />
          </div>
        </div>

        <div>
          <div className="underline">TagInput</div>
          <div className="mt-4 space-y-6">
            <div>
              <MutedText className="mb-2">基础（输入后按回车）：</MutedText>
              <TagInput
                value={basicTags}
                onChange={setBasicTags}
                placeholder="添加标签…"
                label="标签"
                className="max-w-md"
              />
            </div>
            <div>
              <MutedText className="mb-2">带邮箱校验：</MutedText>
              <TagInput
                value={emailTags}
                onChange={setEmailTags}
                placeholder="输入邮箱地址"
                label="邮箱地址"
                validate={(email) =>
                  isValidEmail(email) ? null : "请输入有效的邮箱地址"
                }
                className="max-w-md"
              />
            </div>
            <div>
              <MutedText className="mb-2">带外部错误：</MutedText>
              <TagInput
                value={["tag1", "tag2"]}
                onChange={() => {}}
                placeholder="添加标签…"
                label="标签"
                error="此字段有错误"
                className="max-w-md"
              />
            </div>
          </div>
        </div>

        <div>
          <div className="underline">SettingCard</div>
          <div className="mt-4 space-y-4">
            <SettingCard
              title="邮件通知"
              description="接收关于新邮件和重要更新的通知"
              right={
                <ShadButton variant="outline" size="sm">
                  配置
                </ShadButton>
              }
            />
            <SettingCard
              title="自动回复"
              description="当你不在时自动回复收到的邮件"
              right={
                <ShadButton variant="ghost" size="sm">
                  编辑
                </ShadButton>
              }
            />
            <SettingCard
              title="同步频率"
              description="检查新邮件的频率"
              right={<Badge color="green">每 5 分钟</Badge>}
            />
          </div>
        </div>

        <div>
          <div className="underline">RadioCardGroup</div>
          <MutedText className="mt-2">
            从 N 个选项中选一个，所有选项都应可见，而不是藏在 Select
            后面。按设计只保留标签：在每个选项下加描述会显得杂乱。使用原生单选框，因此方向键可用，整个组是一个
            Tab 停靠点。
          </MutedText>
          <div className="mt-4 max-w-lg space-y-4">
            <RadioCardGroup
              name="demoJoinRule"
              ariaLabel="要加入哪些会议"
              value={joinRule}
              onChange={setJoinRule}
              options={[
                { value: "all", label: "每个带视频链接的通话" },
                {
                  value: "external",
                  label: "只加入有公司外部人员的通话",
                },
                { value: "off", label: "只加入我自己开启的通话" },
              ]}
            />

            <div>
              <MutedText className="mb-2">已禁用：</MutedText>
              <RadioCardGroup
                name="demoJoinRuleDisabled"
                ariaLabel="禁用示例"
                value="a"
                onChange={() => {}}
                disabled
                options={[
                  { value: "a", label: "已选中" },
                  { value: "b", label: "未选中" },
                ]}
              />
            </div>
          </div>
        </div>

        <div>
          <div className="underline">ListCard</div>
          <MutedText className="mt-2">
            一个用分隔线分隔各行的带边框卡片，适用于每一行都是一条记录而非独立卡片的列表。传入带{" "}
            <code>rounded-none</code> 的 <code>Item</code> 行。
          </MutedText>
          <div className="mt-4 max-w-2xl space-y-4">
            <ListCard>
              <Item>
                <ItemContent>
                  <ItemTitle>把记录用邮件发给我</ItemTitle>
                  <ItemDescription>
                    每次通话后把摘要发送到你的收件箱
                  </ItemDescription>
                </ItemContent>
                <Toggle
                  name="demoNotifyByEmail"
                  enabled={notifyByEmail}
                  onChange={setNotifyByEmail}
                />
              </Item>
              <Item>
                <ItemContent>
                  <ItemTitle>每周邮件摘要</ItemTitle>
                  <ItemDescription>每周一早上发送一份摘要</ItemDescription>
                </ItemContent>
                <Badge color="green">开启</Badge>
              </Item>
              <Item>
                <ItemContent>
                  <ItemTitle>没有描述的行</ItemTitle>
                </ItemContent>
                <ShadButton variant="outline" size="sm">
                  配置
                </ShadButton>
              </Item>
            </ListCard>
          </div>
        </div>

        <div>
          <div className="underline">高级版过期横幅</div>
          <div className="mt-4 space-y-4">
            <div>
              <MutedText className="mb-2">Stripe 逾期：</MutedText>
              <PremiumExpiredCardContent
                premium={{
                  lemonSqueezyRenewsAt: null,
                  stripeSubscriptionId: "sub_test123",
                  stripeSubscriptionStatus: "past_due",
                  lemonSqueezySubscriptionId: null,
                  tier: "PRO_MONTHLY",
                }}
              />
            </div>
            <div>
              <MutedText className="mb-2">Stripe 已取消：</MutedText>
              <PremiumExpiredCardContent
                premium={{
                  lemonSqueezyRenewsAt: null,
                  stripeSubscriptionId: "sub_test456",
                  stripeSubscriptionStatus: "canceled",
                  lemonSqueezySubscriptionId: null,
                  tier: "STARTER_MONTHLY",
                }}
              />
            </div>
            <div>
              <MutedText className="mb-2">LemonSqueezy 已过期：</MutedText>
              <PremiumExpiredCardContent
                premium={{
                  lemonSqueezyRenewsAt: new Date(
                    Date.now() - 24 * 60 * 60 * 1000,
                  ), // 昨天
                  stripeSubscriptionId: null,
                  stripeSubscriptionStatus: null,
                  lemonSqueezySubscriptionId: 456,
                  tier: "PRO_ANNUALLY",
                }}
              />
            </div>
            <div>
              <MutedText className="mb-2">无横幅（高级版生效中）：</MutedText>
              <div className="min-h-[20px] text-xs text-muted-foreground">
                <PremiumExpiredCardContent
                  premium={{
                    lemonSqueezyRenewsAt: null,
                    stripeSubscriptionId: "sub_active123",
                    stripeSubscriptionStatus: "active",
                    lemonSqueezySubscriptionId: null,
                    tier: "STARTER_MONTHLY",
                  }}
                />
                生效中的用户不应显示横幅
              </div>
            </div>
            <div>
              <MutedText className="mb-2">
                无横幅（从未开通过高级版）：
              </MutedText>
              <div className="min-h-[20px] text-xs text-muted-foreground">
                <PremiumExpiredCardContent premium={null} />
                从未开通过高级版的用户不应显示横幅
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="underline">邮件行截断</div>
          <div className="mt-4">
            <EmailRowExample />
          </div>
        </div>

        <div className="flex gap-2">
          <TestErrorButton />
          <TestActionButton />
        </div>
      </div>
    </Container>
  );
}

function getRule(): Rule {
  return {
    id: "1",
    name: "测试规则",
    instructions: "测试指令",
    from: null,
    to: null,
    subject: null,
    body: null,
    groupId: null,
    conditionalOperator: "AND",
    createdAt: new Date(),
    updatedAt: new Date(),
    enabled: true,
    automate: true,
    runOnThreads: true,
    emailAccountId: "emailAccountId",
    organizationRuleId: null,
    organizationRuleMemberEnabled: null,
    promptText: null,
    categoryFilterType: null,
    systemType: null,
  };
}

function getRuleWithName(name: string): Rule {
  return {
    ...getRule(),
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
  };
}

function getActivityLogEntries(): ActivityLogEntry[] {
  return [
    {
      id: "1",
      from: "Lenny's Newsletter <lenny@substack.com>",
      subject: "Zapier 的行政助理如何打造一支 AI 实习生大军",
      status: "completed",
      ruleName: "邮件简报",
    },
    {
      id: "2",
      from: "ZenDaily <zendaily@substack.com>",
      subject: "🔮 ZenDaily - 2025 年 12 月 15 日 🔮",
      status: "processing",
      ruleName: "邮件简报",
    },
    {
      id: "3",
      from: "Elie Steinbock <elie@getinboxzero.com>",
      subject: "明天聊",
      status: "processing",
    },
    {
      id: "4",
      from: "Morning Brew <crew@morningbrew.com>",
      subject: "☕ 风暴将至",
      status: "waiting",
    },
    {
      id: "5",
      from: "GitHub <notifications@github.com>",
      subject: "请求评审 PR",
      status: "completed",
      ruleName: "待评审",
    },
  ];
}

function EmailRowExample() {
  return (
    <div className="border rounded-md overflow-hidden">
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <MessageText className="flex items-center">
                    <span className="max-w-[300px] truncate">
                      应该被截断的超长发件人名称
                    </span>
                  </MessageText>
                  <MessageText className="mt-1 truncate font-bold">
                    这是一条极长的主题行，过去会导致表格横向增长
                  </MessageText>
                  <MessageText className="mt-1 line-clamp-2 break-all">
                    这段摘要包含一个不会换行的超长 URL：
                    https://www.this-is-a-very-long-url-that-goes-on-and-on-and-on-and-on-and-on-and-on-and-on-and-on-and-on-and-on.com/test
                  </MessageText>
                </div>
                <div className="ml-4 shrink-0">
                  <ShadButton size="sm">测试</ShadButton>
                </div>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
