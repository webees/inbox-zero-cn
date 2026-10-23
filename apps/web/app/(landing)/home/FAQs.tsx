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
  question: string;
  answer: React.ReactNode;
  answerText?: string;
}[] = [
  {
    question: `${BRAND_NAME} 支持哪些邮件服务商？`,
    answer: "我们支持 Gmail、Google Workspace 和 Microsoft Outlook 邮箱账号。",
  },
  {
    question: "我如何请求新功能？",
    answer: (
      <span>
        给我们发邮件，或在 GitHub 上提交 issue{" "}
        <Anchor href="/github" newTab>
          GitHub
        </Anchor>
        。我们很乐意听到如何改进你的邮件体验。
      </span>
    ),
    answerText:
      "给我们发邮件，或在 GitHub 上提交 issue。我们很乐意听到如何改进你的邮件体验。",
  },
  {
    question: `${BRAND_NAME} 会取代我当前的邮件应用吗？`,
    answer: (
      <span>
        不必如此。{BRAND_NAME} 在 Gmail 和 Outlook 中运行，你可以照常使用它们，
        助手会在后台工作。如果你愿意，{BRAND_NAME} 也有自己的{" "}
        <Anchor href="/email-client">邮件应用</Anchor>
        ，支持网页、桌面端和 iPhone。
      </span>
    ),
    answerText: `不必如此。${BRAND_NAME} 在 Gmail 和 Outlook 中运行，你可以照常使用它们，助手会在后台工作。如果你愿意，${BRAND_NAME} 也有自己的邮件应用，支持网页、桌面端和 iPhone。`,
  },
  {
    question: "有移动应用吗？",
    answer: (
      <span>
        有。我们的原生 iPhone 应用让你随时随地整理收件箱并管理助手。我们还有一款
        Android 应用，即将迎来更新。了解更多请访问{" "}
        <Anchor href="/mobile-app">移动应用</Anchor>页面。
      </span>
    ),
    answerText:
      "有。我们的原生 iPhone 应用让你随时随地整理收件箱并管理助手。我们还有一款 Android 应用，即将迎来更新。了解更多请访问移动应用页面。",
  },
  {
    question: "代码是开源的吗？",
    answer: (
      <span>
        是的！AI 助手、网页应用和桌面端邮件应用都是开源的，代码在我们{" "}
        <Anchor href="/github" newTab>
          GitHub 仓库
        </Anchor>
        。iPhone 应用目前尚未开源，但我们计划开源。
      </span>
    ),
    answerText:
      "是的！AI 助手、网页应用和桌面端邮件应用都是开源的，代码在我们的 GitHub 仓库。iPhone 应用目前尚未开源，但我们计划开源。",
  },
  {
    question: "你们提供退款吗？",
    answer: (
      <span>
        提供，如果你认为我们没有为你带来价值，请在升级后 14 天内给我们
        <Anchor href={`mailto:${env.NEXT_PUBLIC_SUPPORT_EMAIL}`}>发邮件</Anchor>
        ，我们会为你退款。
      </span>
    ),
    answerText:
      "提供，如果你认为我们没有为你带来价值，请在升级后 14 天内给我们发邮件，我们会为你退款。",
  },
  {
    question: `我可以免费试用 ${BRAND_NAME} 吗？`,
    answer:
      "可以。邮件应用免费使用。AI 助手套餐包含 7 天免费试用。开始试用需要绑定信用卡，但在试用结束前不会扣费。你可以在试用期间随时取消，以免产生费用。",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs
    .map((faq) => {
      const text = typeof faq.answer === "string" ? faq.answer : faq.answerText;
      if (!text) return null;
      return {
        "@type": "Question" as const,
        name: faq.question,
        acceptedAnswer: { "@type": "Answer" as const, text },
      };
    })
    .filter(Boolean),
};

export function FAQs() {
  return (
    <Section>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON.stringify on controlled object is safe
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <SectionHeading>常见问题</SectionHeading>
      <SectionContent>
        <CardWrapper>
          <dl className="grid md:grid-cols-2 gap-6">
            {faqs.map((faq) => (
              <Card
                variant="extra-rounding"
                className="gap-4"
                key={faq.question}
              >
                <CardContent>
                  <Paragraph
                    as="dt"
                    color="gray-900"
                    className="font-semibold tracking-tight mb-4"
                  >
                    {faq.question}
                  </Paragraph>
                  <dd>
                    <Paragraph>{faq.answer}</Paragraph>
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
