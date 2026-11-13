import type { I18n } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { differenceInDays } from "date-fns/differenceInDays";

type ShareParams = {
  senderCount: number;
  link: string;
  yearlyEmails?: number | null;
  i18n: I18n;
};

export function buildShareText({
  senderCount,
  link,
  yearlyEmails,
  i18n,
}: ShareParams): string {
  if (yearlyEmails != null) {
    const yearly = i18n.number(yearlyEmails);
    return i18n._(
      msg`I just unsubscribed from ${plural(senderCount, {
        one: "# 个邮件列表",
        other: "# 个邮件列表",
      })} 使用 Inbox Zero 退订后 — 每年少收约 ${yearly} 封邮件。${link}`,
    );
  }
  return i18n._(
    msg`I just unsubscribed from ${plural(senderCount, {
      one: "# 个邮件列表",
      other: "# 个邮件列表",
    })} 使用 Inbox Zero 退订后。${link}`,
  );
}

export function buildXShareUrl(params: ShareParams): string {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(buildShareText(params))}`;
}

export function buildLinkedInShareUrl(params: ShareParams): string {
  return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(buildShareText(params))}`;
}

// 根据这些发件人在所选时间段内的发信频率，预测他们一年会发多少封邮件。
// 真正有价值的是未来省下的邮件，而不是过去几个月的少量邮件。
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
  i18n,
}: {
  emailCount: number;
  dateRange?: { from?: Date; to?: Date };
  i18n: I18n;
}): string {
  const yearlyEmails = projectYearlyEmails({ emailCount, dateRange });
  if (yearlyEmails != null) {
    return i18n._(
      msg`At their current pace, that's about ${plural(yearlyEmails, {
        one: "每年少收 # 封邮件",
        other: "每年少收 # 封邮件",
      })}。`,
    );
  }
  if (emailCount > 0) {
    return i18n._(
      msg`That's ${plural(emailCount, {
        one: "# 封邮件",
        other: "# 封邮件",
      })} 不会再收到。`,
    );
  }
  return i18n._(msg`这些发件人不会再打扰你的收件箱。`);
}

function roundEstimate(value: number): number {
  if (value >= 1000) return Math.round(value / 100) * 100;
  if (value >= 100) return Math.round(value / 10) * 10;
  return Math.round(value);
}
