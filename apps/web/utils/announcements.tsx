import type { ReactNode } from "react";
import {
  Inbox,
  MessagesSquare,
  MonitorSmartphone,
  Rows3,
  Sparkles,
} from "lucide-react";
import { AnnouncementVideo } from "@/components/feature-announcements/AnnouncementVideo";
import { env } from "@/env";

const DETAIL_ICON_CLASS = "size-4";
export const EMAIL_CLIENT_LAUNCH_VIDEO_ID =
  "1K01tCypmkqhB3OZwCzO9j0202K0089aqXX02tYpgoUzztmc";

export interface AnnouncementDetail {
  description?: string;
  icon: ReactNode;
  title: string;
}

export interface Announcement {
  description: string;
  details?: AnnouncementDetail[];
  enabled?: boolean;
  id: string;
  image: ReactNode;
  link?: string;
  linkLabel?: string;
  publishedAt: string;
  secondaryLink?: { href: string; label: string };
  title: string;
}

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: "email-client-launch",
    // 本次发布重点介绍发送功能和原生应用；在发送或邮件应用关闭时隐藏。
    enabled:
      env.NEXT_PUBLIC_EMAIL_SEND_ENABLED && env.NEXT_PUBLIC_MAIL_APP_ENABLED,
    title: "邮件应用已上线",
    description: "快速、内置 AI 助手的邮件应用，支持网页、桌面和 iPhone。",
    image: (
      <AnnouncementVideo
        playbackId={EMAIL_CLIENT_LAUNCH_VIDEO_ID}
        thumbnailTime={1.5}
        title="认识 Inbox Zero 邮件应用"
      />
    ),
    link: "/mail",
    linkLabel: "立即体验",
    secondaryLink: { href: "/download", label: "下载应用" },
    publishedAt: "2026-10-15T00:00:00Z",
    details: [
      {
        title: "网页、桌面和移动端",
        icon: <MonitorSmartphone className={DETAIL_ICON_CLASS} />,
      },
      { title: "统一收件箱", icon: <Inbox className={DETAIL_ICON_CLASS} /> },
      { title: "拆分收件箱", icon: <Rows3 className={DETAIL_ICON_CLASS} /> },
      {
        title: "私密团队评论",
        icon: <MessagesSquare className={DETAIL_ICON_CLASS} />,
      },
      {
        title: "AI 分类和草稿",
        icon: <Sparkles className={DETAIL_ICON_CLASS} />,
      },
    ],
  },
  // {
  //   id: "follow-up-reminders",
  //   title: "跟进提醒",
  //   description:
  //     "跟踪回复，并针对未回复的邮件收到提醒。别让重要邮件从指缝间溜走。",
  //   image: <FollowUpRemindersIllustration />,
  //   link: "/automation?tab=settings",
  //   secondaryLink: { href: "/#", label: "了解更多" },
  //   publishedAt: "2026-01-15T00:00:00Z",
  //   details: [
  //     {
  //       title: "自动跟进标签",
  //       description: "会话 3 天无回复后为其添加标签。",
  //       icon: <Tag className={DETAIL_ICON_CLASS} />,
  //     },
  //     {
  //       title: "自动生成的草稿",
  //       description: "创建草稿以提醒未回复的联系人。",
  //       icon: <FileEdit className={DETAIL_ICON_CLASS} />,
  //     },
  //   ],
  // },
  // {
  //   id: "meeting-briefs",
  //   title: "会议简报",
  //   description:
  //     "在会议前获得 AI 驱动的简报。了解你要见谁以及你们讨论过什么。",
  //   image: <MeetingBriefsIllustration />,
  //   link: "/briefs",
  //   secondaryLink: { href: "/#", label: "了解更多" },
  //   publishedAt: "2024-12-28T00:00:00Z",
  //   details: [
  //     {
  //       title: "AI 驱动的研究",
  //       description: "在会议前研究参会者。",
  //       icon: <Search className={DETAIL_ICON_CLASS} />,
  //     },
  //     {
  //       title: "邮件上下文",
  //       description: "包含与每位嘉宾的近期邮件往来。",
  //       icon: <Mail className={DETAIL_ICON_CLASS} />,
  //     },
  //   ],
  // },
];

export function getActiveAnnouncements(): Announcement[] {
  return ANNOUNCEMENTS.filter((a) => a.enabled !== false).sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

export function hasNewAnnouncements(
  dismissedAt: Date | null | undefined,
): boolean {
  const announcements = getActiveAnnouncements();
  if (announcements.length === 0) return false;
  if (!dismissedAt) return true;
  return announcements.some(
    (a) => new Date(a.publishedAt) > new Date(dismissedAt),
  );
}
