import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Link,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import { InboxZeroFooter } from "./components/inbox-zero-footer";

export type InvoiceEmailProps = {
  baseUrl: string;
  invoiceUrl: string;
};

export default function InvoiceEmail({
  baseUrl,
  invoiceUrl,
}: InvoiceEmailProps) {
  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className="bg-white font-sans">
          <Container className="mx-auto w-full max-w-[600px] p-0">
            <Section className="px-8 py-10">
              <Text className="m-0 text-2xl font-semibold text-gray-900">
                您的 Inbox Zero 发票已就绪
              </Text>
              <Text className="mb-6 mt-4 text-[15px] leading-6 text-gray-600">
                您的 Stripe 付款已成功。您可以在下方下载已付款的发票。
              </Text>
              <Button
                href={invoiceUrl}
                className="box-border rounded-lg bg-blue-600 px-5 py-3 text-[15px] font-semibold text-white no-underline"
              >
                下载发票
              </Button>
              <Text className="mb-0 mt-8 text-[13px] leading-5 text-gray-500">
                您可以在您的{" "}
                <Link href={`${baseUrl}/settings`} className="text-blue-600">
                  结算设置
                </Link>
                中关闭自动发票邮件。
              </Text>
            </Section>
            <InboxZeroFooter />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

InvoiceEmail.PreviewProps = {
  baseUrl: "https://www.getinboxzero.com",
  invoiceUrl: "https://example.com/invoice.pdf",
} satisfies InvoiceEmailProps;
