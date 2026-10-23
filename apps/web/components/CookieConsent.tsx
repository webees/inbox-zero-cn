"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { env } from "@/env";
import {
  useCookieBannerOpen,
  useCookieConsent,
} from "@/hooks/useCookieConsent";
import { BRAND_NAME } from "@/utils/branding";
import { reopenCookieConsent, setCookieConsent } from "@/utils/cookie-consent";

export function CookieConsentBanner() {
  const open = useCookieBannerOpen();
  if (!open) return null;

  return (
    <section
      aria-label="Cookie 同意"
      className="fixed inset-x-3 bottom-3 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300 sm:inset-x-auto sm:left-4 sm:bottom-4 sm:max-w-sm"
    >
      <div className="rounded-xl border bg-background p-4 shadow-lg">
        <p className="text-sm font-medium text-foreground">我们重视你的隐私</p>
        <p className="mt-1 text-sm text-muted-foreground">
          我们使用 cookie 来了解人们如何使用 {BRAND_NAME} 并
          衡量我们的营销效果。你可以随时更改选择。{" "}
          <Link
            href="/privacy"
            className="underline underline-offset-4 hover:text-foreground"
          >
            隐私政策
          </Link>
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCookieConsent("denied")}
          >
            拒绝
          </Button>
          <Button
            variant="primaryBlack"
            size="sm"
            onClick={() => setCookieConsent("granted")}
          >
            接受
          </Button>
        </div>
      </div>
    </section>
  );
}

/** 仅在访问者同意后才渲染跟踪脚本。 */
export function WithCookieConsent({ children }: { children: React.ReactNode }) {
  const consent = useCookieConsent();
  // 没有该横幅时，脚本会像以往一样在服务端渲染。
  if (!env.NEXT_PUBLIC_COOKIE_CONSENT_ENABLED) return children;
  if (consent !== "not-required" && consent !== "granted") return null;

  return children;
}

export function CookieSettingsButton({ className }: { className?: string }) {
  const consent = useCookieConsent();
  if (consent !== "granted" && consent !== "denied") return null;

  return (
    <button type="button" className={className} onClick={reopenCookieConsent}>
      Cookie 设置
    </button>
  );
}
