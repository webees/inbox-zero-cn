import { Card, CardContent } from "@/components/new-landing/common/Card";
import { CardWrapper } from "@/components/new-landing/common/CardWrapper";
import {
  Section,
  SectionContent,
} from "@/components/new-landing/common/Section";
import {
  Paragraph,
  SectionHeading,
  SectionSubtitle,
} from "@/components/new-landing/common/Typography";
import { cn } from "@/utils";
import Image from "next/image";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";

type Award = {
  title: MessageDescriptor;
  description: MessageDescriptor;
  image: string;
  imageSize?: number;
  top?: string;
  hideOnMobile?: boolean;
};

const awards: Award[] = [
  {
    title: msg`符合 SOC2 标准`,
    description: msg`企业级安全，通过 SOC 2 Type 2 认证`,
    image: "/images/new-landing/awards/soc-award.png",
  },
  {
    title: msg`GitHub Trending 第 1 名`,
    description: msg`深受全球开发者信赖与喜爱`,
    image: "/images/new-landing/awards/github-trending-award.png",
    imageSize: 160,
    top: "top-2",
    hideOnMobile: true,
  },
  {
    title: msg`Product Hunt 第 1 名`,
    description: msg`Product Hunt 每日精选产品`,
    image: "/images/new-landing/awards/product-hunt-award.png",
    imageSize: 170,
  },
  {
    title: msg`GitHub 星标 12k+`,
    description: msg`开源透明，清楚了解代码的实际行为`,
    image: "/images/new-landing/awards/github-stars-award.png",
    imageSize: 170,
    top: "top-3",
  },
];

const defaultAwardImageSize = 200;

export function Awards() {
  const { i18n } = useLingui();

  return (
    <Section>
      <SectionHeading>
        <Trans>隐私优先，开源透明</Trans>
      </SectionHeading>
      <SectionSubtitle>
        <Trans>
          你的数据始终私密——不会用于 AI
          训练，也不会有任何猫腻。我们已获得顶级安全认证，如果你希望完全掌控，还可以自行托管
          Inbox Zero。
        </Trans>
      </SectionSubtitle>
      <SectionContent
        noMarginTop
        className="mt-20 gap-x-5 gap-y-20 lg:gap-y-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4"
      >
        {awards.map((award) => (
          <CardWrapper
            padding="sm"
            rounded="sm"
            key={award.image}
            className={cn(award.hideOnMobile && "hidden md:block")}
          >
            <Card
              variant="extra-rounding"
              className="gap-3 h-full relative pt-24 text-center"
            >
              <CardContent>
                <Image
                  className={cn(
                    "absolute left-1/2 -translate-x-1/2 -translate-y-20",
                    award.top || "top-0",
                  )}
                  src={award.image}
                  alt={i18n._(award.title)}
                  width={award.imageSize || defaultAwardImageSize}
                  height={award.imageSize || defaultAwardImageSize}
                />
                <Paragraph color="gray-900" size="md" className="font-bold">
                  {i18n._(award.title)}
                </Paragraph>
                <Paragraph size="sm" className="mt-4">
                  {i18n._(award.description)}
                </Paragraph>
              </CardContent>
            </Card>
          </CardWrapper>
        ))}
      </SectionContent>
    </Section>
  );
}
