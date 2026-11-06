import { differenceInDays } from "date-fns/differenceInDays";

type ShareParams = {
  senderCount: number;
  link: string;
  yearlyEmails?: number | null;
};

export function buildShareText({
  senderCount,
  link,
  yearlyEmails,
}: ShareParams): string {
  const base = `我刚刚用 Inbox Zero 退订了 ${senderCount} 个邮件列表`;
  if (yearlyEmails != null) {
    return `${base}——一年大约少收 ${yearlyEmails.toLocaleString("en-US")} 封邮件。${link}`;
  }
  return `${base}。${link}`;
}

export function buildXShareUrl(params: ShareParams): string {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(buildShareText(params))}`;
}

export function buildLinkedInShareUrl(params: ShareParams): string {
  return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(buildShareText(params))}`;
}

// 根据所选范围内发件人的发信频率，估算这些发件人在一年内会发来多少封邮件。
// 未来省下的这些邮件才是真正的收益，而不是过去几个月里的那几封。
export function projectYearlyEmails({
  emailCount,
  dateRange,
}: {
  emailCount: number;
  dateRange?: { from?: Date; to?: Date };
}): number | null {
  if (emailCount <= 0) return null;
  if (!dateRange?.from || !dateRange?.to) return null;
  const days = differenceInDays(dateRange.to, dateRange.from);
  if (days <= 0) return null;
  return roundEstimate((emailCount * 365) / days);
}

export function buildCelebrationSubline({
  emailCount,
  dateRange,
}: {
  emailCount: number;
  dateRange?: { from?: Date; to?: Date };
}): string {
  const yearlyEmails = projectYearlyEmails({ emailCount, dateRange });
  if (yearlyEmails != null) {
    return `按目前的频率，一年大约会少收 ${yearlyEmails.toLocaleString("en-US")} 封邮件。`;
  }
  if (emailCount > 0) {
    return `这些是你以后不会再收到的 ${emailCount.toLocaleString("en-US")} 封邮件。`;
  }
  return "这些发件人不会再进入你的收件箱。";
}

function roundEstimate(value: number): number {
  if (value >= 1000) return Math.round(value / 100) * 100;
  if (value >= 100) return Math.round(value / 10) * 10;
  return Math.round(value);
}
