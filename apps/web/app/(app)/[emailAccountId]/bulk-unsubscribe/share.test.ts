import { describe, expect, it } from "vitest";
import {
  buildCelebrationSubline,
  buildLinkedInShareUrl,
  buildShareText,
  buildXShareUrl,
  projectYearlyEmails,
} from "./share";

describe("buildShareText", () => {
  it("includes the count and link", () => {
    expect(
      buildShareText({ senderCount: 12, link: "https://www.getinboxzero.com" }),
    ).toBe(
      "我刚刚用 Inbox Zero 退订了 12 个邮件列表。https://www.getinboxzero.com",
    );
  });

  it("uses singular wording for one sender", () => {
    expect(
      buildShareText({ senderCount: 1, link: "https://www.getinboxzero.com" }),
    ).toBe(
      "我刚刚用 Inbox Zero 退订了 1 个邮件列表。https://www.getinboxzero.com",
    );
  });

  it("highlights the projected yearly emails when provided", () => {
    expect(
      buildShareText({
        senderCount: 12,
        link: "https://www.getinboxzero.com",
        yearlyEmails: 2400,
      }),
    ).toBe(
      "我刚刚用 Inbox Zero 退订了 12 个邮件列表——一年大约少收 2,400 封邮件。https://www.getinboxzero.com",
    );
  });

  it("treats a zero projection as a provided estimate", () => {
    expect(
      buildShareText({
        senderCount: 1,
        link: "https://www.getinboxzero.com",
        yearlyEmails: 0,
      }),
    ).toBe(
      "我刚刚用 Inbox Zero 退订了 1 个邮件列表——一年大约少收 0 封邮件。https://www.getinboxzero.com",
    );
  });
});

describe("share intent URLs", () => {
  const params = { senderCount: 5, link: "https://example.com/?ref=abc123" };

  it("builds an X intent URL with the encoded share text", () => {
    const url = buildXShareUrl(params);
    expect(url.startsWith("https://x.com/intent/tweet?text=")).toBe(true);

    const text = new URL(url).searchParams.get("text");
    expect(text).toBe(buildShareText(params));
  });

  it("builds a LinkedIn share URL with the encoded share text", () => {
    const url = buildLinkedInShareUrl(params);
    expect(
      url.startsWith("https://www.linkedin.com/feed/?shareActive=true&text="),
    ).toBe(true);

    const text = new URL(url).searchParams.get("text");
    expect(text).toBe(buildShareText(params));
  });
});

describe("projectYearlyEmails", () => {
  it("annualizes the count from the range length", () => {
    const to = new Date(2026, 5, 12);
    const from = new Date(2026, 2, 14); // 早了 90 天
    // 90 天内 384 封 ≈ 每年 1557 封，四舍五入到最接近的 100
    expect(
      projectYearlyEmails({ emailCount: 384, dateRange: { from, to } }),
    ).toBe(1600);
  });

  it("rounds mid-size estimates to the nearest ten", () => {
    const from = new Date(2026, 0, 1);
    const to = new Date(2026, 0, 31); // 30 天
    // 30 天内 12 封 = 每年 146 封，四舍五入到最接近的 10
    expect(
      projectYearlyEmails({ emailCount: 12, dateRange: { from, to } }),
    ).toBe(150);
  });

  it("returns null without a usable range or count", () => {
    expect(projectYearlyEmails({ emailCount: 0 })).toBeNull();
    expect(projectYearlyEmails({ emailCount: 10 })).toBeNull();
    const sameDay = new Date(2026, 0, 1);
    expect(
      projectYearlyEmails({
        emailCount: 10,
        dateRange: { from: sameDay, to: sameDay },
      }),
    ).toBeNull();
  });
});

describe("buildCelebrationSubline", () => {
  it("frames the win as projected future emails", () => {
    const to = new Date(2026, 5, 12);
    const from = new Date(2026, 2, 14); // 90 days earlier
    expect(
      buildCelebrationSubline({ emailCount: 384, dateRange: { from, to } }),
    ).toBe("按目前的频率，一年大约会少收 1,600 封邮件。");
  });

  it("treats a zero projection as a provided estimate", () => {
    const from = new Date(2026, 0, 1);
    const to = new Date(2028, 8, 27); // 1000 days
    expect(
      buildCelebrationSubline({ emailCount: 1, dateRange: { from, to } }),
    ).toBe("按目前的频率，一年大约会少收 0 封邮件。");
  });

  it("falls back to the raw count when no range is available", () => {
    expect(buildCelebrationSubline({ emailCount: 1234 })).toBe(
      "这些是你以后不会再收到的 1,234 封邮件。",
    );
  });

  it("handles a single past email", () => {
    expect(buildCelebrationSubline({ emailCount: 1 })).toBe(
      "这些是你以后不会再收到的 1 封邮件。",
    );
  });
});
