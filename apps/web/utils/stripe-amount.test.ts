import { describe, expect, it } from "vitest";
import { formatStripeAmount } from "@/utils/stripe-amount";

describe("formatStripeAmount", () => {
  it("formats two-decimal currencies", () => {
    expect(formatStripeAmount(21_600, "usd")).toBe("$216.00");
  });

  it("does not divide zero-decimal currencies", () => {
    expect(formatStripeAmount(21_600, "jpy")).toBe("¥21,600");
  });

  it("uses three decimal places where the currency has them", () => {
    // Intl 会用不换行空格分隔货币代码和金额。
    expect(formatStripeAmount(21_600, "bhd").replace(/\s/g, " ")).toBe(
      "BHD 21.600",
    );
  });

  it("accepts an uppercase currency code", () => {
    expect(formatStripeAmount(21_600, "USD")).toBe("$216.00");
  });
});
