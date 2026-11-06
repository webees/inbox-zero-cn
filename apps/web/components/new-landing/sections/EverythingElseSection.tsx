import Image from "next/image";
import { BlurFade } from "@/components/new-landing/common/BlurFade";
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
import { Analytics } from "@/components/new-landing/icons/Analytics";
import { ChatTwo } from "@/components/new-landing/icons/ChatTwo";
import { Link } from "@/components/new-landing/icons/Link";

export function EverythingElseSection() {
  return (
    <Section>
      <SectionHeading>围绕你真实的工作方式设计</SectionHeading>
      <SectionSubtitle>
        足够灵活，适配任何工作流。足够简单，几分钟就能设置好。
      </SectionSubtitle>
      <SectionContent
        noMarginTop
        className="mt-5 flex flex-col items-center gap-5 sm:mx-10 md:mx-40 lg:mx-0"
      >
        <CardWrapper className="w-full grid grid-cols-1 lg:grid-cols-3 gap-5">
          <BlurFade inView>
            <DisplayCard
              title="邮件分析。能被衡量，才能被管理"
              description="看看谁给你发邮件最多，以及是什么堵塞了你的收件箱。获得清晰的洞察，然后采取行动。"
              icon={<Analytics />}
            >
              <Image
                src="/images/new-landing/metrics.svg"
                alt="指标"
                width={1000}
                height={400}
              />
            </DisplayCard>
          </BlurFade>
          <BlurFade delay={0.25} inView>
            <DisplayCard
              title="了解你日程和空闲时间的草稿"
              description="连接你的日历和 CRM，根据你真实的日程和客户数据起草邮件。"
              icon={<Link />}
            >
              <Image
                src="/images/new-landing/integrations.png"
                alt="应用集成"
                width={1000}
                height={400}
              />
            </DisplayCard>
          </BlurFade>
          <BlurFade delay={0.25 * 2} inView>
            <DisplayCard
              title="为适配你的工作流而生。用大白话自定义"
              description="你的收件箱，你的规则。用大白话配置一切。让它按你真实的工作方式运作。"
              icon={<ChatTwo />}
            >
              <Image
                src="/images/new-landing/create-rules.png"
                alt="自定义"
                width={1000}
                height={400}
              />
            </DisplayCard>
          </BlurFade>
        </CardWrapper>
      </SectionContent>
    </Section>
  );
}
