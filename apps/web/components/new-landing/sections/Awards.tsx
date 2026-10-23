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

type Award = {
  title: string;
  description: string;
  image: string;
  imageSize?: number;
  top?: string;
  hideOnMobile?: boolean;
};

const awards: Award[] = [
  {
    title: "符合 SOC2",
    description: "企业级安全。已通过 SOC 2 Type 2 认证",
    image: "/images/new-landing/awards/soc-award.png",
  },
  {
    title: "GitHub Trending 第 1 名",
    description: "受全球开发者信赖与喜爱",
    image: "/images/new-landing/awards/github-trending-award.png",
    imageSize: 160,
    top: "top-2",
    hideOnMobile: true,
  },
  {
    title: "Product Hunt 第 1 名",
    description: "Product Hunt 当日最佳产品",
    image: "/images/new-landing/awards/product-hunt-award.png",
    imageSize: 170,
  },
  {
    title: "12k+ GitHub 星标",
    description: "开源。代码做了什么一目了然",
    image: "/images/new-landing/awards/github-stars-award.png",
    imageSize: 170,
    top: "top-3",
  },
];

const defaultAwardImageSize = 200;

export function Awards() {
  return (
    <Section>
      <SectionHeading>隐私优先，开源</SectionHeading>
      <SectionSubtitle>
        你的数据保持私密 —— 不用于 AI
        训练，没有猫腻。我们已获得顶级安全的完整认证，如果你想要完全掌控，甚至可以自托管
        Inbox Zero。
      </SectionSubtitle>
      <SectionContent
        noMarginTop
        className="mt-20 gap-x-5 gap-y-20 lg:gap-y-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4"
      >
        {awards.map((award) => (
          <CardWrapper
            padding="sm"
            rounded="sm"
            key={award.title}
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
                  alt={award.title}
                  width={award.imageSize || defaultAwardImageSize}
                  height={award.imageSize || defaultAwardImageSize}
                />
                <Paragraph color="gray-900" size="md" className="font-bold">
                  {award.title}
                </Paragraph>
                <Paragraph size="sm" className="mt-4">
                  {award.description}
                </Paragraph>
              </CardContent>
            </Card>
          </CardWrapper>
        ))}
      </SectionContent>
    </Section>
  );
}
