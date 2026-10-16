"use client";

import { useState } from "react";
import { Tag, FileEdit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AnnouncementContent } from "@/components/feature-announcements/AnnouncementDialog";
import { FollowUpRemindersIllustration } from "@/components/feature-announcements/FollowUpRemindersIllustration";
import type { Announcement } from "@/utils/announcements";

const DETAIL_ICON_CLASS = "h-4 w-4 text-gray-600 dark:text-gray-400";

export function AnnouncementDialogDemo() {
  const [isOpen, setIsOpen] = useState(false);
  const announcement = getDemoAnnouncement();

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>打开公告对话框</Button>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-xl">
          <AnnouncementContent
            announcement={announcement}
            onClose={() => setIsOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function getDemoAnnouncement(): Announcement {
  return {
    id: "follow-up-reminders",
    title: "跟进提醒",
    description:
      "跟踪回复，并针对未回复的邮件获得提醒，不让任何重要邮件被遗漏。",
    image: <FollowUpRemindersIllustration />,
    link: "/automation?tab=settings",
    secondaryLink: { href: "/#", label: "了解更多" },
    publishedAt: "2026-01-15T00:00:00Z",
    details: [
      {
        title: "自动跟进标签",
        description: "在 3 天无回复后为会话添加标签。",
        icon: <Tag className={DETAIL_ICON_CLASS} />,
      },
      {
        title: "自动生成草稿",
        description: "为未回复的联系人生成草稿进行提醒。",
        icon: <FileEdit className={DETAIL_ICON_CLASS} />,
      },
    ],
  };
}
