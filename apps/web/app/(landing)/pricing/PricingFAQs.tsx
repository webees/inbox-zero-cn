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

const pricingFaqs: {
  question: MessageDescriptor;
  answer?: React.ReactNode;
  answerText: MessageDescriptor;
}[] = [
  {
    question: msg`可以免费试用 ${BRAND_NAME} 吗？`,
    answerText: msg`可以。邮件应用可免费使用。AI 套餐包含 7 天免费试用。`,
  },
  {
    question: msg`可以在不同套餐之间切换吗？`,
    answerText: msg`可以，你随时可以升级或降级套餐。更改立即生效，费用按比例计算。`,
  },
  {
    question: msg`支持哪些付款方式？`,
    answerText: msg`我们通过 Stripe 接受所有主流信用卡。`,
  },
  {
    question: msg`是否提供年付折扣？`,
    answerText: msg`提供！任何套餐选择年付最高可节省 20%。`,
  },
  {
    question: msg`是否为学生、非营利组织或开源项目提供折扣？`,
    answer: (
      <span>
        <Trans>
          提供！请发送{" "}
          <Anchor href={`mailto:${env.NEXT_PUBLIC_SUPPORT_EMAIL}`}>邮件</Anchor>{" "}
          给我们，我们会为你设置折扣套餐。
        </Trans>
      </span>
    ),
    answerText: msg`提供！请发送邮件给我们，我们会为你设置折扣套餐。`,
  },
  {
    question: msg`如果取消订阅会怎样？`,
    answerText: msg`你可以随时取消。订阅将保持有效，直到当前计费周期结束。`,
  },
  {
    question: msg`是否提供退款？`,
    answer: (
      <span>
        <Trans>
          可以。如果你认为我们没有为你提供价值，请在升级后 14 天内发送{" "}
          <Anchor href={`mailto:${env.NEXT_PUBLIC_SUPPORT_EMAIL}`}>邮件</Anchor>{" "}
          给我们，我们会为你退款。
        </Trans>
      </span>
    ),
    answerText: msg`可以。如果你认为我们没有为你提供价值，请在升级后 14 天内发送邮件给我们，我们会为你退款。`,
  },
  {
    question: msg`企业需要定制套餐吗？`,
    answer: (
      <span>
        <Trans>
          <Anchor href="https://www.getinboxzero.com/sales">
            联系我们的销售团队
          </Anchor>{" "}
          获取定制价格、SSO、SCIM、本地部署和专属支持。
        </Trans>
      </span>
    ),
    answerText: msg`联系我们的销售团队，获取定制价格、SSO、SCIM、本地部署和专属支持。`,
  },
];

export function PricingFAQs() {
  const { i18n } = useLingui();
  const pricingFaqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: pricingFaqs.map((faq) => ({
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingFaqJsonLd) }}
      />
      <SectionHeading>
        <Trans>套餐常见问题</Trans>
      </SectionHeading>
      <SectionContent>
        <CardWrapper>
          <dl className="grid md:grid-cols-2 gap-6">
            {pricingFaqs.map((faq) => (
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
