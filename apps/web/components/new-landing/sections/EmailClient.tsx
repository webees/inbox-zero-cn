import Image from "next/image";
import Link from "next/link";
import { Gift, Repeat, Zap } from "lucide-react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
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
  title: msg`Meet the Inbox Zero email app`,
  thumbnailTime: 1.5,
};

const starterPrice = tiers[0].price.annually;

const reasons = [
  {
    icon: <Gift className="size-5" />,
    title: msg`免费试用 7 天`,
    description: msg`每个套餐都包含邮件应用和 AI。`,
  },
  {
    icon: <Repeat className="size-5" />,
    title: msg`无需切换`,
    description: msg`更喜欢用 Gmail 或 Outlook？AI 同样可以在那里使用。`,
  },
  {
    icon: <Zap className="size-5" />,
    title: msg`价格低于 Superhuman`,
    description: msg`AI 起草和整理收件箱，每月只需 $${starterPrice} 起，比 Superhuman 收费更低。`,
  },
];

export function EmailClient() {
  const { i18n } = useLingui();
  const videoTitle = i18n._(LAUNCH_VIDEO.title);

  return (
    <Section id={EMAIL_CLIENT_SECTION_ID}>
      <SectionHeading>
        <Trans>在桌面和移动设备上畅快处理邮件</Trans>
      </SectionHeading>
      <SectionSubtitle>
        <Trans>
          将所有 Gmail 和 Outlook 账号汇聚到同一个收件箱，在网页、Mac、Windows
          和 iPhone 上皆可使用。体验媲美 Superhuman，价格更低。
        </Trans>
      </SectionSubtitle>
      <SectionContent>
        <BlurFade inView>
          <div className="relative overflow-hidden rounded-3xl border border-[#EFEFEF] md:rounded-[43px]">
            <HeroVideoDialog
              playbackId={LAUNCH_VIDEO.playbackId}
              thumbnailTime={LAUNCH_VIDEO.thumbnailTime}
              title={videoTitle}
            />
            <Image
              src={`https://image.mux.com/${LAUNCH_VIDEO.playbackId}/thumbnail.jpg?time=${LAUNCH_VIDEO.thumbnailTime}&width=1920`}
              alt={videoTitle}
              width={1920}
              height={1080}
              sizes="(min-width: 1280px) 1152px, (min-width: 1024px) calc(100vw - 64px), calc(100vw - 48px)"
              className="h-auto w-full"
            />
          </div>
        </BlurFade>
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
          {reasons.map((reason) => (
            <CardWrapper key={reason.title.id}>
              <Card variant="extra-rounding" className="h-full">
                <CardContent className="text-left">
                  <div className="mb-3 text-blue-500">{reason.icon}</div>
                  <Paragraph color="gray-900" className="font-semibold">
                    {i18n._(reason.title)}
                  </Paragraph>
                  <Paragraph size="sm" className="mt-1">
                    {i18n._(reason.description)}
                  </Paragraph>
                </CardContent>
              </Card>
            </CardWrapper>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Button size="lg" asChild>
            <Link href={MAIL_CLIENT_SIGNUP_PATH}>
              <span className="relative z-10">
                <Trans>免费试用邮件应用 7 天</Trans>
              </span>
            </Link>
          </Button>
        </div>
      </SectionContent>
    </Section>
  );
}
