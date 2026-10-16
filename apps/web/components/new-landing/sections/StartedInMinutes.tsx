import { Badge } from "@/components/new-landing/common/Badge";
import { BlurFade } from "@/components/new-landing/common/BlurFade";
import { Card } from "@/components/new-landing/common/Card";
import { CardWrapper } from "@/components/new-landing/common/CardWrapper";
import { DisplayCard } from "@/components/new-landing/common/DisplayCard";
import {
  Section,
  SectionContent,
} from "@/components/new-landing/common/Section";
import {
  SectionHeading,
  SectionSubtitle,
} from "@/components/new-landing/common/Typography";
import { AutoOrganize } from "@/components/new-landing/icons/AutoOrganize";
import { Bell } from "@/components/new-landing/icons/Bell";
import { Calendar } from "@/components/new-landing/icons/Calendar";
import { Connect } from "@/components/new-landing/icons/Connect";
import { Envelope } from "@/components/new-landing/icons/Envelope";
import { Fire } from "@/components/new-landing/icons/Fire";
import { Gmail } from "@/components/new-landing/icons/Gmail";
import { Megaphone } from "@/components/new-landing/icons/Megaphone";
import { Newsletter } from "@/components/new-landing/icons/Newsletter";
import { Outlook } from "@/components/new-landing/icons/Outlook";
import { SnowFlake } from "@/components/new-landing/icons/SnowFlake";
import { SparkleBlue } from "@/components/new-landing/icons/SparkleBlue";
import { Team } from "@/components/new-landing/icons/Team";
import Image from "next/image";

interface StartedInMinutesProps {
  subtitle: React.ReactNode;
  title: React.ReactNode;
}

export function StartedInMinutes({ title, subtitle }: StartedInMinutesProps) {
  return (
    <Section>
      <SectionHeading>{title}</SectionHeading>
      <SectionSubtitle>{subtitle}</SectionSubtitle>
      <SectionContent className="sm:mx-10 md:mx-40 lg:mx-0">
        <CardWrapper className="w-full grid grid-cols-1 lg:grid-cols-3 gap-5">
          <BlurFade inView>
            <DisplayCard
              title="连接你的 Google 或 Microsoft 邮箱"
              description="两次点击即可关联你的 Gmail 或 Outlook，马上开始。"
              icon={
                <Badge variant="dark-gray" size="sm" icon={<Connect />}>
                  第 1 步
                </Badge>
              }
              centerContent={true}
              className="h-full"
            >
              <div className="flex gap-4">
                <CardWrapper padding="xs-2" rounded="full">
                  <Card variant="circle">
                    <div className="p-2 translate-y-1">
                      <Gmail width="64" height="64" />
                    </div>
                  </Card>
                </CardWrapper>
                <CardWrapper padding="xs-2" rounded="full">
                  <Card variant="circle">
                    <div className="p-2 translate-y-1">
                      <Outlook width="64" height="64" />
                    </div>
                  </Card>
                </CardWrapper>
              </div>
            </DisplayCard>
          </BlurFade>
          <BlurFade delay={0.25} inView>
            <DisplayCard
              title="完全按你想要的方式整理收件箱"
              description="智能类别自动设置好。使用我们的类别，或创建你自己的。"
              icon={
                <Badge variant="dark-gray" size="sm" icon={<AutoOrganize />}>
                  第 2 步
                </Badge>
              }
              centerContent
              className="h-full"
            >
              <div className="flex flex-col gap-2 scale-[110%]">
                <div className="flex gap-2">
                  <Badge variant="purple" icon={<Newsletter />}>
                    简报
                  </Badge>
                  <Badge variant="dark-blue" icon={<Envelope />}>
                    待回复
                  </Badge>
                  <Badge variant="green" icon={<Megaphone />}>
                    营销
                  </Badge>
                  <Badge variant="yellow" icon={<Calendar />}>
                    日历
                  </Badge>
                </div>
                <div className="flex gap-2">
                  <Badge variant="red" icon={<Bell />}>
                    通知
                  </Badge>
                  <Badge variant="light-blue" icon={<SnowFlake />}>
                    冷邮件
                  </Badge>
                  <Badge variant="orange" icon={<Team />}>
                    团队
                  </Badge>
                  <Badge variant="pink" icon={<Fire />}>
                    紧急
                  </Badge>
                </div>
              </div>
            </DisplayCard>
          </BlurFade>
          <BlurFade delay={0.25 * 2} inView>
            <DisplayCard
              title="根据你的邮件历史和日历预先起草的回复"
              description="你收到的每封需要回复的邮件都会有一封预先写好的草稿。"
              icon={
                <Badge variant="dark-gray" size="sm" icon={<SparkleBlue />}>
                  STEP 3
                </Badge>
              }
            >
              <div className="pt-6 pl-6">
                <Image
                  src="/images/new-landing/new-message.png"
                  alt="预先起草的回复"
                  width={1407}
                  height={852}
                  sizes="(min-width: 1280px) 333px, (min-width: 1152px) 312px, (min-width: 1024px) calc(33.333vw - 72px), (min-width: 768px) calc(100vw - 432px), (min-width: 640px) calc(100vw - 192px), calc(100vw - 112px)"
                  className="h-auto w-full"
                />
              </div>
            </DisplayCard>
          </BlurFade>
        </CardWrapper>
      </SectionContent>
    </Section>
  );
}
