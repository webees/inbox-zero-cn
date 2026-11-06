import type { Metadata } from "next";
import { Testimonials } from "@/components/new-landing/sections/Testimonials";
import { Hero, HeroContent } from "@/app/(landing)/home/Hero";
import { Pricing } from "@/components/new-landing/sections/Pricing";
import { Awards } from "@/components/new-landing/sections/Awards";
import { EverythingElseSection } from "@/components/new-landing/sections/EverythingElseSection";
import { StartedInMinutes } from "@/components/new-landing/sections/StartedInMinutes";
import { BulkUnsubscribe } from "@/components/new-landing/sections/BulkUnsubscribe";
import { OrganizedInbox } from "@/components/new-landing/sections/OrganizedInbox";
import { PreWrittenDrafts } from "@/components/new-landing/sections/PreWrittenDrafts";
import { ManageFromAnywhere } from "@/components/new-landing/sections/ManageFromAnywhere";
import {
  EMAIL_CLIENT_SECTION_ID,
  EmailClient,
} from "@/components/new-landing/sections/EmailClient";
import { BasicLayout } from "@/components/layouts/BasicLayout";
import { FAQs } from "@/app/(landing)/home/FAQs";
import { FinalCTA } from "@/app/(landing)/home/FinalCTA";
import { WordReveal } from "@/components/new-landing/common/WordReveal";
import { SectionLink } from "@/components/new-landing/common/SectionLink";
import { env } from "@/env";
import { BRAND_NAME } from "@/utils/branding";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function NewLanding() {
  if (env.NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS) {
    return (
      <BasicLayout>
        <Hero
          title={`${BRAND_NAME} 面向自托管团队`}
          subtitle={`在你自己的基础设施上部署 ${BRAND_NAME}，在完全掌控数据的前提下自动化你的收件箱。`}
        />
      </BasicLayout>
    );
  }

  return (
    <BasicLayout>
      <Hero
        badge={
          <SectionLink sectionId={EMAIL_CLIENT_SECTION_ID}>
            New: Inbox Zero Mail app →
          </SectionLink>
        }
        title={
          <WordReveal
            spaceBetween="w-2 md:w-3"
            words={[
              "认识",
              "你的",
              "真正",
              <em key="actually">管用的</em>,
              "AI",
              "邮件",
              "助手",
            ]}
          />
        }
        subtitle={`${BRAND_NAME} 整理你的收件箱和日历、以你的口吻起草回复，并帮助你快速做到收件箱清零。再也不会错过重要邮件。`}
      >
        <HeroContent />
      </Hero>
      <OrganizedInbox
        title={
          <>
            自动整理。
            <br />
            再也不会错过重要邮件。
          </>
        }
        subtitle="被邮件淹没？别再费力给邮件排优先级了。我们的 AI 助手会自动给一切打标签。"
      />
      <PreWrittenDrafts
        title="预先写好的草稿就在你的收件箱里等着"
        subtitle="当你查看收件箱时，每封需要回复的邮件都已有一封以你口吻预先起草好的回复，随时可以发送。"
      />
      <ManageFromAnywhere />
      <EmailClient />
      <StartedInMinutes
        title="几分钟即可上手"
        subtitle="一键设置。几分钟内就开始整理邮件并起草回复。"
      />
      <BulkUnsubscribe />
      <EverythingElseSection />
      <Awards />
      <Pricing />
      <Testimonials />
      <FinalCTA />
      <FAQs />
    </BasicLayout>
  );
}
