import { extractEmailAddress, splitRecipientList } from "@/utils/email";

export type SendAsAddress = {
  email: string;
  name?: string;
  isDefault: boolean;
  /** The provider's signature for this address, as HTML. */
  signature?: string;
};

/**
 * 回复发出的地址：在 `candidates` 中找到的用户自己地址中的
 * 第一个，就像 Gmail 从某个别名回复发往该别名的邮件一样。
 * 回退到默认地址。
 */
export function findReplySendAsAddress(
  candidates: string | undefined,
  addresses: SendAsAddress[],
): SendAsAddress | undefined {
  const byEmail = new Map(
    addresses.map((address) => [address.email.toLowerCase(), address]),
  );
  for (const candidate of splitRecipientList(candidates ?? "")) {
    const match = byEmail.get(extractEmailAddress(candidate).toLowerCase());
    if (match) return match;
  }
  return addresses.find((address) => address.isDefault);
}

export function formatSendAsAddress({ email, name }: SendAsAddress) {
  if (!name || name === email) return email;
  return `"${name.replace(/["\\]/g, "\\$&")}" <${email}>`;
}
