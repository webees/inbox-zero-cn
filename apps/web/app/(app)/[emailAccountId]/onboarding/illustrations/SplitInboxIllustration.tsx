"use client";

import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { FileIcon, InboxIcon, SendIcon, StarIcon } from "lucide-react";
import { getMailSidebarRowPresentation } from "@inboxzero/mail-ui/MailSidebarRow";
import { MailThreadRow } from "@inboxzero/mail-ui/MailThreadRow";
import { MailLabelChip } from "@/app/(app)/[emailAccountId]/mail/MailLabelChip";
import { SplitTabs } from "@/app/(app)/[emailAccountId]/mail/SplitTabs";
import { IllustrationWindow } from "@/app/(app)/[emailAccountId]/onboarding/illustrations/IllustrationWindow";

const ALL_SPLIT_ID = "All";
const splitNames = ["待回复", "新闻邮件", "日历", "收据"];
// 示意图依次切换这些标签页，以展示分类逐步缩小列表范围。
const cycle = [ALL_SPLIT_ID, "待回复", "新闻邮件"];

const threads = [
  {
    from: "Sarah Chen",
    subject: msg`第三季度规划：你能审核一下吗？`,
    snippet: msg`我先起草了一版路线图，很想听听你的意见`,
    date: msg`上午 10:24`,
    label: "待回复",
    unread: true,
  },
  {
    from: "The Weekly Digest",
    subject: msg`本周值得借鉴的五个点子`,
    snippet: msg`此外还有一篇关于高转化定价页面的深度分析`,
    date: msg`上午 9:40`,
    label: "新闻邮件",
    unread: true,
  },
  {
    from: "Priya Patel",
    subject: msg`我们能把周四的通话改个时间吗？`,
    snippet: msg`我这边临时有事。改成周五上午可以吗？`,
    date: msg`上午 9:12`,
    label: "待回复",
    unread: true,
  },
  {
    from: "Jordan Lee",
    subject: msg`邀请：设计同步会`,
    snippet: msg`周四下午 2:00 至 2:30。请通过视频链接加入`,
    date: msg`上午 8:55`,
    label: "日历",
    unread: false,
  },
  {
    from: "Acme Billing",
    subject: msg`你的收据 #2041`,
    snippet: msg`感谢你支付 $49.00。收据已附上`,
    date: msg`昨天`,
    label: "收据",
    unread: false,
  },
  {
    from: "Product Notes",
    subject: msg`我们十月发布的新功能`,
    snippet: msg`更快的搜索、离线模式，以及全新的键盘快捷键一览表`,
    date: msg`昨天`,
    label: "新闻邮件",
    unread: false,
  },
  {
    from: "Marcus Wright",
    subject: msg`回复：设计团队介绍`,
    snippet: msg`很高兴认识你！我很乐意分享品牌规范`,
    date: msg`周一`,
    label: "待回复",
    unread: false,
  },
];

const countsById = new Map(
  splitNames.map((name) => [
    name,
    threads.filter((thread) => thread.label === name).length,
  ]),
);

const sidebarItems = [
  { id: "inbox", name: msg`收件箱`, Icon: InboxIcon, count: threads.length },
  { id: "starred", name: msg`已加星标`, Icon: StarIcon, count: null },
  { id: "sent", name: msg`已发送`, Icon: SendIcon, count: null },
  { id: "drafts", name: msg`草稿`, Icon: FileIcon, count: null },
];

export function SplitInboxIllustration() {
  const { i18n } = useLingui();
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
  const splits = [ALL_SPLIT_ID, ...splitNames].map((id) => ({
    id,
    // Split names are real label names, so only "全部" is translated.
    name: id === ALL_SPLIT_ID ? i18n._(msg`全部`) : id,
    deletable: false,
  }));

  return (
    <IllustrationWindow className="w-full max-w-[720px]">
      <div className="flex h-[440px]">
        <nav className="hidden w-44 shrink-0 flex-col gap-0.5 border-r border-border bg-sidebar p-2 sm:flex">
          {sidebarItems.map(({ id, name, Icon, count }) => {
            const { className, content } = getMailSidebarRowPresentation({
              active: id === "inbox",
              icon: <Icon className="size-4 shrink-0" />,
              name: i18n._(name),
              count,
              emphasizeCount: true,
            });
            return (
              <div key={id} className={className}>
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
                key={thread.subject.id}
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
                  subject={i18n._(thread.subject)}
                  snippet={i18n._(thread.snippet)}
                  date={
                    <span className="text-xs text-muted-foreground">
                      {i18n._(thread.date)}
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
