import Image from "next/image";
import { Globe, Smartphone } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { BlurFade } from "@/components/new-landing/common/BlurFade";
import { Card } from "@/components/new-landing/common/Card";
import { CardWrapper } from "@/components/new-landing/common/CardWrapper";
import {
  Section,
  SectionContent,
} from "@/components/new-landing/common/Section";
import {
  SectionHeading,
  SectionSubtitle,
} from "@/components/new-landing/common/Typography";

type Platform = {
  name: string;
  icon: React.ReactNode;
};

export function ManageFromAnywhere({
  title = <Trans>无论在哪里工作，都能处理你的收件箱</Trans>,
  subtitle = (
    <Trans>
      无需切换应用，即可通过 Slack、Telegram、Microsoft
      Teams、移动端或网页阅读邮件、起草回复并管理收件箱。
    </Trans>
  ),
  platforms,
}: {
  platforms?: Platform[];
  subtitle?: React.ReactNode;
  title?: React.ReactNode;
}) {
  const { t } = useLingui();
  const shownPlatforms = platforms ?? [
    {
      name: "Slack",
      icon: (
        <Image src="/images/slack.svg" alt="Slack" width={56} height={56} />
      ),
    },
    {
      name: "Telegram",
      icon: (
        <Image
          src="/images/telegram.svg"
          alt="Telegram"
          width={56}
          height={56}
        />
      ),
    },
    {
      name: "Teams",
      icon: (
        <Image
          src="/images/teams.png"
          alt="Teams 团队协作平台"
          width={56}
          height={56}
        />
      ),
    },
    {
      name: t`iOS 和 Android`,
      icon: <Smartphone className="size-10 text-gray-600" strokeWidth={1.5} />,
    },
    {
      name: t`网页`,
      icon: <Globe className="size-10 text-gray-600" strokeWidth={1.5} />,
    },
  ];

  return (
    <Section>
      <SectionHeading>{title}</SectionHeading>
      <SectionSubtitle>{subtitle}</SectionSubtitle>
      <SectionContent className="flex justify-center">
        <BlurFade inView>
          <div className="flex flex-wrap items-start justify-center gap-6 sm:gap-10">
            {shownPlatforms.map((platform) => (
              <PlatformIcon key={platform.name} {...platform} />
            ))}
          </div>
        </BlurFade>
      </SectionContent>
    </Section>
  );
}

function PlatformIcon({ name, icon }: { name: string; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <CardWrapper padding="xs-2" rounded="full">
        <Card variant="circle">
          <div className="flex size-20 items-center justify-center">{icon}</div>
        </Card>
      </CardWrapper>
      <span className="text-sm font-medium text-gray-500">{name}</span>
    </div>
  );
}
