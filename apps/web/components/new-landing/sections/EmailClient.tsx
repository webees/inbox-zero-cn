import Image from "next/image";
import Link from "next/link";
import { Gift, Repeat, Zap } from "lucide-react";
import { HeroVideoDialog } from "@/app/(landing)/home/HeroVideoDialog";
import { BlurFade } from "@/components/new-landing/common/BlurFade";
import { Button } from "@/components/new-landing/common/Button";
import { Card, CardContent } from "@/components/new-landing/common/Card";
import { CardWrapper } from "@/components/new-landing/common/CardWrapper";
import {
  Section,
  SectionContent,
} from "@/components/new-landing/common/Section";
import {
  Paragraph,
  SectionHeading,
  SectionSubtitle,
} from "@/components/new-landing/common/Typography";
import { tiers } from "@/app/(app)/premium/config";
import { MAIL_CLIENT_SIGNUP_PATH } from "@/utils/config";

export const EMAIL_CLIENT_SECTION_ID = "email-client";

const LAUNCH_VIDEO = {
  playbackId: "1K01tCypmkqhB3OZwCzO9j0202K0089aqXX02tYpgoUzztmc",
  title: "认识 Inbox Zero 邮件应用",
  thumbnailTime: 1.5,
};

const reasons = [
  {
    icon: <Gift className="size-5" />,
    title: "免费使用",
    description: "应用免费使用。只有你想要时才添加 AI。",
  },
  {
    icon: <Repeat className="size-5" />,
    title: "无需切换",
    description: "更喜欢用 Gmail 或 Outlook？AI 在那里同样可用。",
  },
  {
    icon: <Zap className="size-5" />,
    title: "价格只有 Superhuman 的一半",
    description: `AI 草稿和分类收件箱每月 $${tiers[0].price.annually} 起，只有 Superhuman 收费的一半。`,
  },
];

export function EmailClient() {
  return (
    <Section id={EMAIL_CLIENT_SECTION_ID}>
      <SectionHeading>在桌面端和移动端飞速处理邮件</SectionHeading>
      <SectionSubtitle>
        所有 Gmail 和 Outlook 邮箱账号汇聚到一个收件箱，覆盖网页、Mac、Windows
        和 iPhone。像 Superhuman，但免费。
      </SectionSubtitle>
      <SectionContent>
        <BlurFade inView>
          <div className="relative overflow-hidden rounded-3xl border border-[#EFEFEF] md:rounded-[43px]">
            <HeroVideoDialog
              playbackId={LAUNCH_VIDEO.playbackId}
              thumbnailTime={LAUNCH_VIDEO.thumbnailTime}
              title={LAUNCH_VIDEO.title}
            />
            <Image
              src={`https://image.mux.com/${LAUNCH_VIDEO.playbackId}/thumbnail.jpg?time=${LAUNCH_VIDEO.thumbnailTime}&width=1920`}
              alt={LAUNCH_VIDEO.title}
              width={1920}
              height={1080}
              sizes="(min-width: 1280px) 1152px, (min-width: 1024px) calc(100vw - 64px), calc(100vw - 48px)"
              className="h-auto w-full"
            />
          </div>
        </BlurFade>
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
          {reasons.map((reason) => (
            <CardWrapper key={reason.title}>
              <Card variant="extra-rounding" className="h-full">
                <CardContent className="text-left">
                  <div className="mb-3 text-blue-500">{reason.icon}</div>
                  <Paragraph color="gray-900" className="font-semibold">
                    {reason.title}
                  </Paragraph>
                  <Paragraph size="sm" className="mt-1">
                    {reason.description}
                  </Paragraph>
                </CardContent>
              </Card>
            </CardWrapper>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Button size="lg" asChild>
            <Link href={MAIL_CLIENT_SIGNUP_PATH}>
              <span className="relative z-10">免费试用邮件应用</span>
            </Link>
          </Button>
        </div>
      </SectionContent>
    </Section>
  );
}
