"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { FileIcon, InboxIcon, SendIcon, StarIcon } from "lucide-react";
import { getMailSidebarRowPresentation } from "@inboxzero/mail-ui/MailSidebarRow";
import { MailThreadRow } from "@inboxzero/mail-ui/MailThreadRow";
import { MailLabelChip } from "@/app/(app)/[emailAccountId]/mail/MailLabelChip";
import { SplitTabs } from "@/app/(app)/[emailAccountId]/mail/SplitTabs";
import { IllustrationWindow } from "@/app/(app)/[emailAccountId]/onboarding/illustrations/IllustrationWindow";

const ALL_SPLIT_ID = "All";
const splitNames = ["待回复", "新闻通讯", "日历", "收据"];
// 插画会依次切换这些标签页，展示分栏如何缩小列表范围。
const cycle = [ALL_SPLIT_ID, "待回复", "新闻通讯"];

const threads = [
  {
    from: "Sarah Chen",
    subject: "第三季度规划：你能审阅一下吗？",
    snippet: "我整理了第一版路线图，希望你能帮忙看看",
    date: "上午 10:24",
    label: "待回复",
    unread: true,
  },
  {
    from: "每周摘要",
    subject: "本周值得借鉴的五个想法",
    snippet: "此外还有关于高转化定价页面的深入分析",
    date: "上午 9:40",
    label: "新闻通讯",
    unread: true,
  },
  {
    from: "Priya Patel",
    subject: "周四的通话能改期吗？",
    snippet: "我这边临时有事，改成周五上午可以吗？",
    date: "上午 9:12",
    label: "待回复",
    unread: true,
  },
  {
    from: "Jordan Lee",
    subject: "邀请：设计同步会",
    snippet: "周四下午 2:00 至 2:30。通过视频链接加入",
    date: "上午 8:55",
    label: "日历",
    unread: false,
  },
  {
    from: "Acme 账单",
    subject: "你的收据 #2041",
    snippet: "感谢你支付 49.00 美元。收据已附上",
    date: "昨天",
    label: "收据",
    unread: false,
  },
  {
    from: "产品动态",
    subject: "我们十月份发布了什么",
    snippet: "更快的搜索、离线模式以及全新的键盘快捷键速查表",
    date: "昨天",
    label: "新闻通讯",
    unread: false,
  },
  {
    from: "Marcus Wright",
    subject: "回复：设计团队介绍",
    snippet: "很高兴认识你！很乐意分享品牌指南",
    date: "周一",
    label: "待回复",
    unread: false,
  },
];

const splits = [ALL_SPLIT_ID, ...splitNames].map((name) => ({
  id: name,
  name,
  deletable: false,
}));

const countsById = new Map(
  splitNames.map((name) => [
    name,
    threads.filter((thread) => thread.label === name).length,
  ]),
);

const sidebarItems = [
  { name: "收件箱", Icon: InboxIcon, count: threads.length },
  { name: "已加星标", Icon: StarIcon, count: null },
  { name: "已发送", Icon: SendIcon, count: null },
  { name: "草稿", Icon: FileIcon, count: null },
];

export function SplitInboxIllustration() {
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    const interval = setInterval(() => setStep((s) => s + 1), 2800);
    return () => clearInterval(interval);
  }, [reduceMotion]);

  const activeSplitId = cycle[step % cycle.length];
  const visibleThreads =
    activeSplitId === ALL_SPLIT_ID
      ? threads
      : threads.filter((thread) => thread.label === activeSplitId);

  return (
    <IllustrationWindow className="w-full max-w-[720px]">
      <div className="flex h-[440px]">
        <nav className="hidden w-44 shrink-0 flex-col gap-0.5 border-r border-border bg-sidebar p-2 sm:flex">
          {sidebarItems.map(({ name, Icon, count }) => {
            const { className, content } = getMailSidebarRowPresentation({
              active: name === "收件箱",
              icon: <Icon className="size-4 shrink-0" />,
              name,
              count,
              emphasizeCount: true,
            });
            return (
              <div key={name} className={className}>
                {content}
              </div>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 overflow-hidden bg-background [mask-image:linear-gradient(to_bottom,#000_80%,transparent)]">
          <SplitTabs
            className="pt-3"
            splits={splits}
            activeSplitId={activeSplitId}
            countsById={countsById}
            onSelect={noop}
            onDelete={noop}
            onNewSplit={noop}
            canCreateSplits
          />
          <AnimatePresence initial={false} mode="popLayout">
            {visibleThreads.map((thread, index) => (
              <motion.div
                key={thread.subject}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <MailThreadRow
                  index={index}
                  layout="split"
                  participantSummary={thread.from}
                  subject={thread.subject}
                  snippet={thread.snippet}
                  date={
                    <span className="text-xs text-muted-foreground">
                      {thread.date}
                    </span>
                  }
                  labels={[
                    <MailLabelChip key={thread.label} name={thread.label} />,
                  ]}
                  isUnread={thread.unread}
                  isStarred={false}
                  isDraft={false}
                  messageCount={1}
                  isFocused={false}
                  isSelected={false}
                  hasAnySelection={false}
                  selectionEnabled={false}
                  onOpen={noop}
                  onToggleSelect={noop}
                  onSelectRangeTo={noop}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </IllustrationWindow>
  );
}

function noop() {}
