// Stripe 金额使用货币的最小单位，这并不总是
// 一个单位的 1/100：JPY 没有小数单位，BHD 有三位小数。
// 无条件除以 100 会把日元扣款低估 100 倍。
export function formatStripeAmount(
  amountInMinorUnits: number,
  currency: string,
) {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  });
  const { maximumFractionDigits = 2 } = formatter.resolvedOptions();

  return formatter.format(amountInMinorUnits / 10 ** maximumFractionDigits);
}
