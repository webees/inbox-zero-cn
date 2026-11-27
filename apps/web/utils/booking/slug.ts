import { slugify } from "@/utils/string";

const FALLBACK_BOOKING_SLUG = "booking-link";

export function getBookingLinkSlugSuggestion(name: string | null | undefined) {
  const trimmed = name?.trim();
  const firstName =
    trimmed && !trimmed.includes("@")
      ? (trimmed.split(/\s+/)[0] ?? null)
      : null;
  const slug = normalizeBookingSlug(firstName ?? FALLBACK_BOOKING_SLUG);

  if (slug.length >= 3) return slug;
  if (slug) return normalizeBookingSlug(`${slug}-booking`);

  return FALLBACK_BOOKING_SLUG;
}

export function normalizeBookingSlug(value: string) {
  // 公开预约 slug 必须匹配 ^[a-z0-9]+(?:-[a-z0-9]+)*$，因此去除
  // 变音符号（"Café" -> "cafe"），并在运行共享的 slugify 之前
  // 丢弃任何剩余的非 ASCII 字符。
  const ascii = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return slugify(ascii)
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
