import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { Locale } from "@/utils/i18n/locales";
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

export function HomePage({ locale }: { locale: Locale }) {
  if (env.NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS) {
    return (
      <BasicLayout locale={locale}>
        <Hero
          title={<Trans>{BRAND_NAME} for self-hosted teams</Trans>}
          subtitle={
            <Trans>
              Deploy {BRAND_NAME} on your own infrastructure and automate your
              inbox with full data control.
            </Trans>
          }
        />
      </BasicLayout>
    );
  }

  return (
    <BasicLayout locale={locale}>
      <Hero
        badge={
          <SectionLink sectionId={EMAIL_CLIENT_SECTION_ID}>
            <Trans>新功能：Inbox Zero Mail 应用 →</Trans>
          </SectionLink>
        }
        title={<HeroTitle />}
        subtitle={
          <Trans>
            {BRAND_NAME}{" "}
            可整理你的收件箱和日历，以你的语气起草回复，并帮助你快速实现收件箱清零。再也不会错过重要邮件。
          </Trans>
        }
      >
        <HeroContent />
      </Hero>
      <OrganizedInbox
        title={
          <Trans>
            自动整理。
            <br />
            再也不会错过重要邮件。
          </Trans>
        }
        subtitle={
          <Trans>
            被邮件淹没了吗？不要把精力浪费在手动给邮件排优先级上。我们的 AI
            助手会自动为所有内容添加标签。
          </Trans>
        }
      />
      <PreWrittenDrafts
        title={<Trans>收件箱里已有预先写好的草稿</Trans>}
        subtitle={
          <Trans>
            当你查看收件箱时，每封需要回复的邮件都会有一份以你的语气预先起草的回复，随时可以发送。
          </Trans>
        }
      />
      <ManageFromAnywhere />
      <EmailClient />
      <StartedInMinutes
        title={<Trans>几分钟即可开始</Trans>}
        subtitle={<Trans>一键设置。几分钟内即可开始整理邮件和起草回复。</Trans>}
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

// Starred words in the translated title render in italics, e.g. *actually*.
function HeroTitle() {
  const { i18n } = useLingui();
  // *starred* text is emphasized; translations may star more than one word.
  const words = i18n
    ._(msg`Meet your AI email assistant that *actually* works`)
    .split(/(\*[^*]+\*)/)
    .flatMap((part, partIndex) => {
      const emphasized = part.startsWith("*") && part.endsWith("*");
      const text = emphasized ? part.slice(1, -1) : part;
      return text
        .split(" ")
        .filter(Boolean)
        .map((word, wordIndex) =>
          emphasized ? <em key={`${partIndex}-${wordIndex}`}>{word}</em> : word,
        );
    });

  return <WordReveal spaceBetween="w-2 md:w-3" words={words} />;
}
