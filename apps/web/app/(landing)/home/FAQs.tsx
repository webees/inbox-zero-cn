import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Anchor } from "@/components/new-landing/common/Anchor";
import { Card, CardContent } from "@/components/new-landing/common/Card";
import { CardWrapper } from "@/components/new-landing/common/CardWrapper";
import {
  Section,
  SectionContent,
} from "@/components/new-landing/common/Section";
import {
  Paragraph,
  SectionHeading,
} from "@/components/new-landing/common/Typography";
import { env } from "@/env";
import { BRAND_NAME } from "@/utils/branding";

const faqs: {
  question: MessageDescriptor;
  answer?: React.ReactNode;
  answerText: MessageDescriptor;
}[] = [
  {
    question: msg`${BRAND_NAME} 支持哪些电子邮件服务商？`,
    answerText: msg`我们支持 Gmail、Google Workspace 和 Microsoft Outlook 邮箱账号。`,
  },
  {
    question: msg`如何申请新功能？`,
    answer: (
      <span>
        <Trans>
          请给我们发邮件，或在{" "}
          <Anchor href="/github" newTab>
            GitHub
          </Anchor>
          上提交问题。我们很乐意听取如何改善你的邮件体验。
        </Trans>
      </span>
    ),
    answerText: msg`请给我们发邮件，或在 GitHub 上提交问题。我们很乐意听取如何改善你的邮件体验。`,
  },
  {
    question: msg`${BRAND_NAME} 会取代我当前的电子邮件应用吗？`,
    answer: (
      <span>
        <Trans>
          不一定。{BRAND_NAME} 在 Gmail 和 Outlook
          内运行，因此你可以照常使用它们，同时助手会在后台工作。如果你想使用的话，
          {BRAND_NAME} 也有自己的{" "}
          <Anchor href="/email-client">电子邮件应用</Anchor>，支持网页、桌面端和
          iPhone。
        </Trans>
      </span>
    ),
    answerText: msg`不一定。${BRAND_NAME} 在 Gmail 和 Outlook 内运行，因此你可以照常使用它们，同时助手会在后台工作。如果你想使用的话，${BRAND_NAME} 也有自己的电子邮件应用，支持网页、桌面端和 iPhone。`,
  },
  {
    question: msg`有移动应用吗？`,
    answer: (
      <span>
        <Trans>
          有。我们的原生 iPhone
          应用让你可以随时随地整理收件箱并管理助手。我们还有一款 Android
          应用，即将更新。请前往 <Anchor href="/mobile-app">移动应用</Anchor>
          页面了解更多。
        </Trans>
      </span>
    ),
    answerText: msg`有。我们的原生 iPhone 应用让你可以随时随地整理收件箱并管理助手。我们还有一款 Android 应用，即将更新。请前往移动应用页面了解更多。`,
  },
  {
    question: msg`代码是开源的吗？`,
    answer: (
      <span>
        <Trans>
          是！AI 助手、网页应用和桌面电子邮件应用都在我们的{" "}
          <Anchor href="/github" newTab>
            GitHub 仓库
          </Anchor>
          中开源。iPhone 应用尚未开源，但我们计划将其开源。
        </Trans>
      </span>
    ),
    answerText: msg`是！AI 助手、网页应用和桌面电子邮件应用都在我们的 GitHub 仓库中开源。iPhone 应用尚未开源，但我们计划将其开源。`,
  },
  {
    question: msg`你们提供退款吗？`,
    answer: (
      <span>
        <Trans>
          提供。如果你认为我们没有为你带来价值，请在升级后 14 天内给我们发送{" "}
          <Anchor href={`mailto:${env.NEXT_PUBLIC_SUPPORT_EMAIL}`}>
            电子邮件
          </Anchor>
          ，我们将为你退款。
        </Trans>
      </span>
    ),
    answerText: msg`提供。如果你认为我们没有为你带来价值，请在升级后 14 天内给我们发送电子邮件，我们将为你退款。`,
  },
  {
    question: msg`我可以免费试用 ${BRAND_NAME} 吗？`,
    answerText: msg`可以。电子邮件应用可免费使用。AI 助手套餐包含 7 天免费试用。开始试用需要提供信用卡，但在试用结束前不会收费。你可以在试用期间随时取消，以免被收费。`,
  },
];

export function FAQs() {
  const { i18n } = useLingui();
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: i18n._(faq.question),
      acceptedAnswer: { "@type": "Answer", text: i18n._(faq.answerText) },
    })),
  };

  return (
    <Section>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON.stringify on controlled object is safe
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <SectionHeading>
        <Trans>常见问题</Trans>
      </SectionHeading>
      <SectionContent>
        <CardWrapper>
          <dl className="grid md:grid-cols-2 gap-6">
            {faqs.map((faq) => (
              <Card
                variant="extra-rounding"
                className="gap-4"
                key={faq.question.id}
              >
                <CardContent>
                  <Paragraph
                    as="dt"
                    color="gray-900"
                    className="font-semibold tracking-tight mb-4"
                  >
                    {i18n._(faq.question)}
                  </Paragraph>
                  <dd>
                    <Paragraph>
                      {faq.answer ?? i18n._(faq.answerText)}
                    </Paragraph>
                  </dd>
                </CardContent>
              </Card>
            ))}
          </dl>
        </CardWrapper>
      </SectionContent>
    </Section>
  );
}
