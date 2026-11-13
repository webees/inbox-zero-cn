import type { ReactNode } from "react";
import {
  Inbox,
  MessagesSquare,
  MonitorSmartphone,
  Rows3,
  Sparkles,
} from "lucide-react";
import { AnnouncementVideo } from "@/components/feature-announcements/AnnouncementVideo";

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
    title: "邮件应用已上线",
    description:
      "一款适用于网页、桌面端和 iPhone 的快速邮件应用，内置你的 AI 助手。",
    image: (
      <AnnouncementVideo
        playbackId={EMAIL_CLIENT_LAUNCH_VIDEO_ID}
        thumbnailTime={1.5}
        title="认识 Inbox Zero 邮件应用"
      />
    ),
    link: "/mail",
    linkLabel: "试用",
    secondaryLink: { href: "/download", label: "下载应用" },
    publishedAt: "2026-10-15T00:00:00Z",
    details: [
      {
        title: "网页、桌面端和移动端",
        icon: <MonitorSmartphone className={DETAIL_ICON_CLASS} />,
      },
      { title: "统一收件箱", icon: <Inbox className={DETAIL_ICON_CLASS} /> },
      { title: "分类收件箱", icon: <Rows3 className={DETAIL_ICON_CLASS} /> },
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
  //     "跟踪回复并提醒你未回复的邮件。绝不让重要邮件被遗漏。",
  //   image: <FollowUpRemindersIllustration />,
  //   link: "/automation?tab=settings",
  //   secondaryLink: { href: "/#", label: "了解更多" },
  //   publishedAt: "2026-01-15T00:00:00Z",
  //   details: [
  //     {
  //       title: "自动跟进标签",
  //       description: "在 3 天没有回复后为会话打上标签。",
  //       icon: <Tag className={DETAIL_ICON_CLASS} />,
  //     },
  //     {
  //       title: "自动生成的草稿",
  //       description: "创建草稿以催促未回复的联系人。",
  //       icon: <FileEdit className={DETAIL_ICON_CLASS} />,
  //     },
  //   ],
  // },
  // {
  //   id: "meeting-briefs",
  //   title: "会议简报",
  //   description:
  //     "在会议前获取 AI 生成的简报。了解你会见的是谁，以及你们讨论过什么。",
  //   image: <MeetingBriefsIllustration />,
  //   link: "/briefs",
  //   secondaryLink: { href: "/#", label: "了解更多" },
  //   publishedAt: "2024-12-28T00:00:00Z",
  //   details: [
  //     {
  //       title: "AI 调研",
  //       description: "在会议前调研参会者。",
  //       icon: <Search className={DETAIL_ICON_CLASS} />,
  //     },
  //     {
  //       title: "邮件背景",
  //       description: "包含与每位来宾的近期邮件往来。",
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
