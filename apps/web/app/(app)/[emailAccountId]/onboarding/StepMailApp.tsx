"use client";

import { AnnouncementVideo } from "@/components/feature-announcements/AnnouncementVideo";
import { EMAIL_CLIENT_LAUNCH_VIDEO_ID } from "@/utils/announcements";
import { OnboardingFeatureStep } from "./OnboardingFeatureStep";

export function StepMailApp({ onNext }: { onNext: () => void }) {
  return (
    <OnboardingFeatureStep
      illustration={
        <div className="w-[400px] max-w-[calc(100vw-2rem)]">
          <AnnouncementVideo
            playbackId={EMAIL_CLIENT_LAUNCH_VIDEO_ID}
            thumbnailTime={1.5}
            title="认识 Inbox Zero 邮件应用"
          />
        </div>
      }
      title="认识你的新邮件应用"
      description="在网页、桌面端和 iPhone 上收发邮件。随时随地添加 AI 助手。"
      onNext={onNext}
    />
  );
}
