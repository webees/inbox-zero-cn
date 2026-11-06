import { CheckIcon, MinusIcon } from "lucide-react";
import { CardWrapper } from "@/components/new-landing/common/CardWrapper";
import {
  Section,
  SectionContent,
} from "@/components/new-landing/common/Section";
import { SectionHeading } from "@/components/new-landing/common/Typography";
import { tiers } from "@/app/(app)/premium/config";

type FeatureValue = boolean | string;

const features: {
  name: string;
  starter: FeatureValue;
  plus: FeatureValue;
  professional: FeatureValue;
}[] = [
  {
    name: "整理并标记邮件",
    starter: true,
    plus: true,
    professional: true,
  },
  {
    name: "以你的口吻起草回复",
    starter: true,
    plus: true,
    professional: true,
  },
  {
    name: "拦截冷邮件",
    starter: true,
    plus: true,
    professional: true,
  },
  {
    name: "批量退订",
    starter: true,
    plus: true,
    professional: true,
  },
  {
    name: "批量归档",
    starter: true,
    plus: true,
    professional: true,
  },
  {
    name: "邮件分析",
    starter: true,
    plus: true,
    professional: true,
  },
  {
    name: "会前简报",
    starter: true,
    plus: true,
    professional: true,
  },
  {
    name: "AI 会议记录者",
    starter: false,
    plus: true,
    professional: true,
  },
  {
    name: "邮件摘要",
    starter: false,
    plus: true,
    professional: true,
  },
  {
    name: "Slack 集成",
    starter: false,
    plus: true,
    professional: true,
  },
  {
    name: "应用集成（Notion、Stripe 等）",
    starter: false,
    plus: true,
    professional: true,
  },
  {
    name: "自动归档附件",
    starter: false,
    plus: true,
    professional: true,
  },
  {
    name: "知识库",
    starter: "有限",
    plus: "不限",
    professional: "不限",
  },
  {
    name: "团队级分析",
    starter: false,
    plus: false,
    professional: true,
  },
  {
    name: "优先支持",
    starter: false,
    plus: false,
    professional: true,
  },
  {
    name: "专属引导流程经理",
    starter: false,
    plus: false,
    professional: true,
  },
];

const tierHeaders = tiers.map((tier) => ({
  name: tier.name,
  price: `$${tier.price.monthly}`,
}));

function FeatureCell({ value }: { value: FeatureValue }) {
  if (typeof value === "string") {
    return <span className="text-sm text-gray-700">{value}</span>;
  }
  if (value) {
    return <CheckIcon className="h-5 w-5 text-blue-500 mx-auto" />;
  }
  return <MinusIcon className="h-5 w-5 text-gray-300 mx-auto" />;
}

export function PricingComparisonTable() {
  return (
    <Section>
      <SectionHeading>对比套餐</SectionHeading>
      <SectionContent>
        <CardWrapper>
          <div className="overflow-x-auto rounded-[20px] border border-[#E7E7E780] bg-white">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#E7E7E780]">
                  <th className="py-4 px-6 text-sm font-medium text-gray-500">
                    功能
                  </th>
                  {tierHeaders.map((tier) => (
                    <th
                      key={tier.name}
                      className="py-4 px-6 text-center min-w-[140px]"
                    >
                      <div className="text-sm font-semibold text-gray-900">
                        {tier.name}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {tier.price}/月
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {features.map((feature, index) => (
                  <tr
                    key={feature.name}
                    className={
                      index < features.length - 1
                        ? "border-b border-[#E7E7E780]"
                        : ""
                    }
                  >
                    <td className="py-3.5 px-6 text-sm text-gray-700">
                      {feature.name}
                    </td>
                    <td className="py-3.5 px-6 text-center">
                      <FeatureCell value={feature.starter} />
                    </td>
                    <td className="py-3.5 px-6 text-center">
                      <FeatureCell value={feature.plus} />
                    </td>
                    <td className="py-3.5 px-6 text-center">
                      <FeatureCell value={feature.professional} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardWrapper>
      </SectionContent>
    </Section>
  );
}
