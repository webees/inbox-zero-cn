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
  question: string;
  answer: React.ReactNode;
  answerText?: string;
}[] = [
  {
    question: `我可以免费试用 ${BRAND_NAME} 吗？`,
    answer: "可以。邮件应用可免费使用。AI 套餐包含 7 天免费试用。",
  },
  {
    question: "我可以在套餐之间切换吗？",
    answer: "可以，你可以随时升级或降级。更改立即生效，费用按比例结算。",
  },
  {
    question: "你们接受哪些支付方式？",
    answer: "我们通过 Stripe 接受所有主流信用卡。",
  },
  {
    question: "你们提供年付折扣吗？",
    answer: "提供！任何套餐选择年付最多可节省 20%。",
  },
  {
    question: "你们为学生、非营利组织或开源项目提供折扣吗？",
    answer: (
      <span>
        提供！给我们{" "}
        <Anchor href={`mailto:${env.NEXT_PUBLIC_SUPPORT_EMAIL}`}>邮件</Anchor>{" "}
        ，我们会为你设置一个折扣套餐。
      </span>
    ),
    answerText: "提供！给我们发邮件，我们会为你设置一个折扣套餐。",
  },
  {
    question: "如果我取消会怎样？",
    answer: "你可以随时取消。你的订阅会一直保持有效，直到当前计费周期结束。",
  },
  {
    question: "你们提供退款吗？",
    answer: (
      <span>
        提供，如果你认为我们没有为你带来价值，请在升级后 14 天内给我们{" "}
        <Anchor href={`mailto:${env.NEXT_PUBLIC_SUPPORT_EMAIL}`}>邮件</Anchor>{" "}
        ，我们会为你退款。
      </span>
    ),
    answerText:
      "提供，如果你认为我们没有为你带来价值，请在升级后 14 天内给我们发邮件，我们会为你退款。",
  },
  {
    question: "你的企业需要定制套餐吗？",
    answer: (
      <span>
        <Anchor href="https://www.getinboxzero.com/sales">
          联系我们的销售团队
        </Anchor>{" "}
        ，获取定制定价、SSO、SCIM、本地部署和专属支持。
      </span>
    ),
    answerText:
      "联系我们的销售团队，获取定制定价、SSO、SCIM、本地部署和专属支持。",
  },
];

const pricingFaqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: pricingFaqs
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

export function PricingFAQs() {
  return (
    <Section>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON.stringify on controlled object is safe
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingFaqJsonLd) }}
      />
      <SectionHeading>定价常见问题</SectionHeading>
      <SectionContent>
        <CardWrapper>
          <dl className="grid md:grid-cols-2 gap-6">
            {pricingFaqs.map((faq) => (
              <Card
                variant="extra-rounding"
                className="gap-4"
                key={typeof faq.question === "string" ? faq.question : ""}
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
