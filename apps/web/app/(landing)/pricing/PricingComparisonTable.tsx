import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { CheckIcon, MinusIcon } from "lucide-react";
import { CardWrapper } from "@/components/new-landing/common/CardWrapper";
import {
  Section,
  SectionContent,
} from "@/components/new-landing/common/Section";
import { SectionHeading } from "@/components/new-landing/common/Typography";
import { tiers } from "@/app/(app)/premium/config";

type FeatureValue = boolean | MessageDescriptor;

const features: {
  name: MessageDescriptor;
  starter: FeatureValue;
  plus: FeatureValue;
  professional: FeatureValue;
}[] = [
  {
    name: msg`整理邮件并添加标签`,
    starter: true,
    plus: true,
    professional: true,
  },
  {
    name: msg`以你的语气起草回复`,
    starter: true,
    plus: true,
    professional: true,
  },
  {
    name: msg`拦截冷邮件`,
    starter: true,
    plus: true,
    professional: true,
  },
  {
    name: msg`批量退订`,
    starter: true,
    plus: true,
    professional: true,
  },
  {
    name: msg`批量归档`,
    starter: true,
    plus: true,
    professional: true,
  },
  {
    name: msg`邮件分析`,
    starter: true,
    plus: true,
    professional: true,
  },
  {
    name: msg`会议前简报`,
    starter: true,
    plus: true,
    professional: true,
  },
  {
    name: msg`AI 会议记录助手`,
    starter: false,
    plus: true,
    professional: true,
  },
  {
    name: msg`邮件摘要`,
    starter: false,
    plus: true,
    professional: true,
  },
  {
    name: msg`Slack 集成`,
    starter: false,
    plus: true,
    professional: true,
  },
  {
    name: msg`应用集成（Notion、Stripe 等）`,
    starter: false,
    plus: true,
    professional: true,
  },
  {
    name: msg`自动归档附件`,
    starter: false,
    plus: true,
    professional: true,
  },
  {
    name: msg`知识库`,
    starter: msg`受限`,
    plus: msg`无限制`,
    professional: msg`无限制`,
  },
  {
    name: msg`团队范围分析`,
    starter: false,
    plus: false,
    professional: true,
  },
  {
    name: msg`优先支持`,
    starter: false,
    plus: false,
    professional: true,
  },
  {
    name: msg`专属引导流程经理`,
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
  const { i18n } = useLingui();
  if (typeof value === "object") {
    return <span className="text-sm text-gray-700">{i18n._(value)}</span>;
  }
  if (value) {
    return <CheckIcon className="h-5 w-5 text-blue-500 mx-auto" />;
  }
  return <MinusIcon className="h-5 w-5 text-gray-300 mx-auto" />;
}

export function PricingComparisonTable() {
  const { i18n } = useLingui();

  return (
    <Section>
      <SectionHeading>
        <Trans>比较套餐</Trans>
      </SectionHeading>
      <SectionContent>
        <CardWrapper>
          <div className="overflow-x-auto rounded-[20px] border border-[#E7E7E780] bg-white">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#E7E7E780]">
                  <th className="py-4 px-6 text-sm font-medium text-gray-500">
                    <Trans>功能</Trans>
                  </th>
                  {tierHeaders.map(({ name, price }) => (
                    <th
                      key={name}
                      className="py-4 px-6 text-center min-w-[140px]"
                    >
                      <div className="text-sm font-semibold text-gray-900">
                        {name}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        <Trans>{price}/月</Trans>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {features.map((feature, index) => (
                  <tr
                    key={feature.name.id}
                    className={
                      index < features.length - 1
                        ? "border-b border-[#E7E7E780]"
                        : ""
                    }
                  >
                    <td className="py-3.5 px-6 text-sm text-gray-700">
                      {i18n._(feature.name)}
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
