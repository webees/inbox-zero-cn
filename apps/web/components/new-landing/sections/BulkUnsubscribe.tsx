import Image from "next/image";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  Section,
  SectionContent,
} from "@/components/new-landing/common/Section";
import { CardWrapper } from "@/components/new-landing/common/CardWrapper";
import {
  SectionHeading,
  SectionSubtitle,
} from "@/components/new-landing/common/Typography";

export function BulkUnsubscribe() {
  const { t } = useLingui();

  return (
    <Section>
      <SectionHeading>
        <Trans>
          快速实现 Inbox Zero。
          <br />
          批量退订你从不阅读的邮件。
        </Trans>
      </SectionHeading>
      <SectionSubtitle>
        <Trans>查看你从不阅读的邮件，一键退订并归档。</Trans>
      </SectionSubtitle>
      <SectionContent className="flex justify-center items-center">
        <CardWrapper
          padding="xs"
          rounded="md"
          className="hidden md:block md:mx-20 lg:mx-40 xl:mx-52"
        >
          <Image
            src="/images/new-landing/bulk-unsubscribe.png"
            alt={t`批量退订`}
            width={1000}
            height={1000}
          />
        </CardWrapper>
        <div className="flex flex-col gap-2">
          <CardWrapper padding="xs" rounded="md" className="block md:hidden">
            <Image
              src="/images/new-landing/bulk-unsubscribe-mobile.png"
              alt={t`批量退订`}
              width={1000}
              height={1000}
            />
          </CardWrapper>
        </div>
      </SectionContent>
    </Section>
  );
}
