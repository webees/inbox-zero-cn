import type { Metadata } from "next";
import { BasicLayout } from "@/components/layouts/BasicLayout";
import {
  Section,
  SectionContent,
} from "@/components/new-landing/common/Section";
import {
  PageHeading,
  Paragraph,
} from "@/components/new-landing/common/Typography";
import { BlurFade } from "@/components/new-landing/common/BlurFade";
import { StoreBadges } from "@/app/(landing)/app/StoreBadges";
import { BRAND_NAME, getBrandTitle } from "@/utils/branding";

export const metadata: Metadata = {
  title: getBrandTitle("获取应用"),
  description: `${BRAND_NAME} 现已登陆 iPhone 和 Android。随时随地整理收件箱、起草回复并做到收件箱清零。`,
  alternates: { canonical: "/app" },
};

export default function AppPage() {
  return (
    <BasicLayout>
      <Section className="mt-10 md:mt-20">
        <PageHeading>{BRAND_NAME} 登陆你的手机</PageHeading>
        <BlurFade duration={0.4} delay={0.125 * 2}>
          <Paragraph size="lg" className="mx-auto mt-6 max-w-[640px]">
            你的 AI 邮件助手，现已登陆 iPhone 和
            Android。随时随地整理收件箱、以你的口吻起草回复，并做到收件箱清零。
          </Paragraph>
        </BlurFade>
        <SectionContent className="mt-8 md:mt-10">
          <BlurFade duration={0.4} delay={0.125 * 4}>
            <StoreBadges />
          </BlurFade>
          <BlurFade duration={0.4} delay={0.125 * 5}>
            <Paragraph color="light" size="sm" className="mt-5">
              免费下载。
            </Paragraph>
          </BlurFade>
        </SectionContent>
      </Section>
    </BasicLayout>
  );
}
