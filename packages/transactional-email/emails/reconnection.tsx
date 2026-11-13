import {
  Body,
  Button,
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

export type ReconnectionEmailProps = {
  baseUrl: string;
  email: string;
  unsubscribeToken: string;
};

type ReconnectionEmailComponent = FC<ReconnectionEmailProps> & {
  PreviewProps: ReconnectionEmailProps;
};

const ReconnectionEmail: ReconnectionEmailComponent = ({
  baseUrl = "https://www.getinboxzero.com",
  email,
  unsubscribeToken,
}: ReconnectionEmailProps) => {
  const reconnectUrl = `${baseUrl}/accounts`;

  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className="bg-white font-sans">
          <Container className="mx-auto w-full max-w-[600px] p-0">
            {/* Header */}
            <Section className="p-4 text-center">
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
                <span className="font-semibold tracking-tighter">
                  Inbox Zero
                </span>
              </Text>

              <Text className="mx-0 mb-8 mt-0 p-0 text-center text-2xl font-normal text-gray-900">
                需要操作：你的邮箱账号已断开连接
              </Text>
            </Section>

            {/* Main Content */}
            <Section className="px-4 pb-4">
              <Text className="text-[16px] text-gray-700 mb-6 mt-0">
                你好，
              </Text>

              <Text className="text-[16px] text-gray-700 mb-6 mt-0">
                <strong>{email}</strong> 与 Inbox Zero 的连接已断开。
                这通常发生在更改密码之后、访问权限被撤销，或你的 6
                个月授权期已过期时。
              </Text>

              <Text className="text-[16px] text-gray-700 mb-8 mt-0">
                请重新连接你的账号，以恢复自动邮件规则和 AI 助手功能。
              </Text>

              {/* CTA Button */}
              <Section className="text-center mb-8">
                <Button
                  href={reconnectUrl}
                  className="bg-blue-600 text-white px-8 py-4 rounded-[8px] text-[16px] font-semibold no-underline box-border inline-block"
                >
                  立即重新连接
                </Button>
              </Section>

              <Text className="text-[14px] text-gray-500 mb-8 mt-0">
                如果你没有预料到这一点，这很可能是你的邮件服务商采取的安全措施。
                重新连接是安全的，只需几秒钟。
              </Text>
            </Section>

            {/* Footer */}
            <Hr className="border-solid border-gray-200 my-6" />
            <Footer baseUrl={baseUrl} unsubscribeToken={unsubscribeToken} />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default ReconnectionEmail;

function Footer({
  baseUrl,
  unsubscribeToken,
}: {
  baseUrl: string;
  unsubscribeToken: string;
}) {
  return (
    <Section className="mt-8 text-center text-sm text-gray-500">
      <Text className="m-0">
        你收到这封邮件，是因为你的邮箱账号已连接到 Inbox Zero。
      </Text>
      <div className="mt-2">
        <Link
          href={`${baseUrl}/api/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`}
          className="text-gray-500 underline mr-4"
        >
          退订
        </Link>
        <Link
          href={`${baseUrl}/support`}
          className="text-gray-500 underline mr-4"
        >
          支持
        </Link>
        <Link href={`${baseUrl}/privacy`} className="text-gray-500 underline">
          隐私政策
        </Link>
      </div>
    </Section>
  );
}

ReconnectionEmail.PreviewProps = {
  baseUrl: "https://www.getinboxzero.com",
  email: "user@example.com",
  unsubscribeToken: "preview-token-123",
};
