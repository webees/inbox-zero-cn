import { Link, Section, Text } from "@react-email/components";

export function StatsEmailFooter({
  baseUrl,
  unsubscribeToken,
}: {
  baseUrl: string;
  unsubscribeToken: string;
}) {
  return (
    <Section>
      <Text>
        您收到此邮件是因为您订阅了 Inbox Zero 统计更新。您可以在您的{" "}
        <Link
          href={`${baseUrl}/settings#email-updates`}
          className="text-[15px]"
        >
          设置
        </Link>
        中更改。
      </Text>

      <Link
        href={`${baseUrl}/api/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`}
        className="text-[15px]"
      >
        退订此类邮件
      </Link>
    </Section>
  );
}
