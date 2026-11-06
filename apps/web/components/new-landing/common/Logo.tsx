"use client";

import { CopyIcon, ExternalLinkIcon, PaletteIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo as Wordmark } from "@/components/Logo";
import { toastError, toastSuccess } from "@/components/Toast";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/utils";
import { HAS_BRAND_KIT } from "@/utils/branding";

interface LogoProps {
  variant?: "default" | "mobile";
}

export function Logo({ variant = "default" }: LogoProps) {
  const router = useRouter();
  const sizeClass = variant === "mobile" ? "h-4 w-auto" : "h-5 w-auto";

  const link = (
    <Link href="/">
      <Wordmark className={cn(sizeClass, "text-gray-900")} />
    </Link>
  );

  if (!HAS_BRAND_KIT) return link;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{link}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={() => window.open("/", "_blank")}>
          <ExternalLinkIcon className="mr-2 size-4" />
          在新标签页中打开链接
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={copyLogoSvg}>
          <CopyIcon className="mr-2 size-4" />
          复制 Logo 为 SVG
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => router.push("/brand")}>
          <PaletteIcon className="mr-2 size-4" />
          前往品牌资源包
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

async function copyLogoSvg() {
  try {
    // 传入 Promise 可在 SVG 加载期间让 Safari 保持用户手势有效。
    const svg = fetch("/brand/inbox-zero-wordmark-dark.svg")
      .then((res) => {
        if (!res.ok) throw new Error(`Logo 请求失败：${res.status}`);
        return res.text();
      })
      .then((text) => new Blob([text], { type: "text/plain" }));
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": svg })]);
    toastSuccess({ description: "已复制 Logo 为 SVG" });
  } catch {
    toastError({ description: "无法复制 Logo" });
  }
}
