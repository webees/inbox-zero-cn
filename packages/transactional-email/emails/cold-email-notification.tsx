import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import type { FC } from "react";

export type ColdEmailNotificationProps = {
  baseUrl: string;
};

type ColdEmailNotificationComponent = FC<ColdEmailNotificationProps> & {
  PreviewProps: ColdEmailNotificationProps;
};

const ColdEmailNotification: ColdEmailNotificationComponent = ({
  baseUrl = "https://www.getinboxzero.com",
}: ColdEmailNotificationProps) => (
  <Html>
    <Head />
    <Tailwind>
      <Body className="bg-white font-sans">
        <Container className="mx-auto w-full max-w-[600px] p-0">
          <Section className="p-8 text-center">
            <Link href={baseUrl} className="text-[15px]">
              <Img
                src={"https://www.getinboxzero.com/icon.png"}
                width="40"
                height="40"
                alt="Inbox Zero"
                className="mx-auto my-0"
              />
            </Link>
            <Text className="mx-0 mb-8 mt-4 p-0 text-center text-2xl font-normal">
              <span className="font-semibold tracking-tighter">Inbox Zero</span>
            </Text>
          </Section>

          <Section className="px-8 pb-8">
            <Text className="text-[16px] text-gray-700 mb-4 mt-0">
              收件人使用{" "}
              <Link href={baseUrl} className="text-blue-600 underline">
                Inbox Zero
              </Link>{" "}
              自动识别并过滤来自首次发件人的冷邮件。
            </Text>
            <Text className="text-[16px] text-gray-700 mb-4 mt-0">
              您的邮件被识别为未经请求的主动推销，已被过滤。
            </Text>
            <Text className="text-[16px] text-gray-700 mb-0 mt-0">
              如果这是误发，或您需要联系对方，请尝试其他联系方式。
            </Text>
          </Section>

          <Hr className="border-solid border-gray-200 my-6" />
          <Section className="mt-4 mb-8 text-center text-sm text-gray-500">
            <Text className="m-0">
              这是来自{" "}
              <Link href={baseUrl} className="text-blue-600 underline">
                Inbox Zero
              </Link>
              的自动消息。
            </Text>
          </Section>
        </Container>
      </Body>
    </Tailwind>
  </Html>
);

export default ColdEmailNotification;

ColdEmailNotification.PreviewProps = {
  baseUrl: "https://www.getinboxzero.com",
};
