import { extractEmailAddress } from "@/utils/email";

export function isWhitelistedSender(
  from: string,
  whitelist: string | undefined,
) {
  const address = extractEmailAddress(from).toLowerCase();
  if (!address) return false;

  // 应用程序豁免是邮箱专属的；域条目仅用于 Gmail 过滤器。
  return (
    whitelist?.split(/\s+OR\s+/i).some((entry) => {
      const whitelistedAddress = extractEmailAddress(entry).toLowerCase();
      return address === whitelistedAddress;
    }) ?? false
  );
}
