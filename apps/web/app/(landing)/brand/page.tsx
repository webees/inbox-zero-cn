import { DownloadIcon } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { CopyButton } from "@/app/(landing)/brand/CopyButton";
import { FinalCTA } from "@/app/(landing)/home/FinalCTA";
import { Footer } from "@/app/(landing)/home/Footer";
import { Logo } from "@/components/Logo";
import { BlogHeader } from "@/components/layouts/BlogLayout";
import { Button } from "@/components/new-landing/common/Button";
import {
  PageHeading,
  Paragraph,
} from "@/components/new-landing/common/Typography";
import { env } from "@/env";
import { cn } from "@/utils";
import { getBrandTitle, HAS_BRAND_KIT } from "@/utils/branding";

export const metadata: Metadata = {
  title: getBrandTitle("Brand Kit"),
  description: "用于一致展示 Inbox Zero 品牌的标准 Logo、颜色与规范。",
  alternates: { canonical: "/brand" },
};

const BOILERPLATE =
  "Inbox Zero 是一款开源的 AI 邮件助手，也是 Superhuman 的替代方案。它能整理你的收件箱、用你的语气撰写回复，并帮助你快速实现收件箱清零，同时提供完整的 Gmail 和 Outlook 邮件客户端。";

const SCREENSHOT_SRC = "/images/new-landing/inbox-zero-mail.webp";

const logos: {
  name: string;
  theme: "dark" | "light";
  preview: React.ReactNode;
  downloads: { label: string; href: string }[];
}[] = [
  {
    name: "深色背景上的文字标识",
    theme: "dark",
    preview: <Logo className="h-7 w-auto text-white" />,
    downloads: [
      { label: ".svg", href: "/brand/inbox-zero-wordmark-light.svg" },
      { label: ".png", href: "/brand/inbox-zero-wordmark-light.png" },
    ],
  },
  {
    name: "浅色背景上的文字标识",
    theme: "light",
    preview: <Logo className="h-7 w-auto text-gray-900" />,
    downloads: [
      { label: ".svg", href: "/brand/inbox-zero-wordmark-dark.svg" },
      { label: ".png", href: "/brand/inbox-zero-wordmark-dark.png" },
    ],
  },
  {
    name: "深色背景上的应用图标",
    theme: "dark",
    preview: <AppIcon size={88} />,
    downloads: [{ label: ".png", href: "/brand/inbox-zero-icon.png" }],
  },
  {
    name: "浅色背景上的应用图标",
    theme: "light",
    preview: <AppIcon size={88} />,
    downloads: [{ label: ".png", href: "/brand/inbox-zero-icon.png" }],
  },
];

const colors = [
  { name: "天蓝色", hex: "#67B0F2" },
  { name: "收件箱蓝", hex: "#3478F6" },
  { name: "墨色", hex: "#111827" },
  { name: "白色", hex: "#FFFFFF" },
];

export default function BrandPage() {
  if (!HAS_BRAND_KIT) notFound();

  return (
    <>
      <BlogHeader />

      <div className="mx-auto max-w-4xl px-6 pb-24">
        <div className="flex flex-col items-center pt-20 text-center">
          <AppIcon size={112} />
          <div className="mt-6">
            <PageHeading>品牌资源包</PageHeading>
          </div>
          <Paragraph className="mt-4" size="lg">
            用于一致展示 Inbox Zero 品牌的标准与资源。
          </Paragraph>
          <div className="mt-8">
            <Button size="lg" asChild>
              <a href="/brand/inbox-zero-brand-assets.zip" download>
                下载全部资源
              </a>
            </Button>
          </div>
        </div>

        <BrandSection title="命名">
          <BrandText>
            “Inbox Zero”是品牌名称，始终为两个单词，每个单词首字母大写。
          </BrandText>
          <BrandText>
            不要写作“InboxZero”、“Inbox-Zero”、“inbox zero”或其他任何变体。
          </BrandText>
        </BrandSection>

        <BrandSection title="Logo">
          <BrandText>
            空间充裕时使用文字标识，空间紧张时使用应用图标。请勿以任何方式改动这些文件。
          </BrandText>
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
            {logos.map((logo) => (
              <div
                key={logo.name}
                className={cn(
                  "group relative flex h-48 items-center justify-center rounded-2xl border",
                  logo.theme === "dark"
                    ? "border-gray-800 bg-gray-950"
                    : "border-gray-200 bg-gray-50",
                )}
              >
                <span className="sr-only">{logo.name}</span>
                {logo.preview}
                <div className="absolute right-3 bottom-3 flex gap-2 transition-opacity [@media(hover:hover)]:opacity-0 group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
                  {logo.downloads.map((download) => (
                    <a
                      key={download.label}
                      href={download.href}
                      download
                      aria-label={`下载 ${logo.name}（${download.label} 格式）`}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-xs",
                        logo.theme === "dark"
                          ? "bg-white/10 text-white hover:bg-white/20"
                          : "bg-gray-900/5 text-gray-700 hover:bg-gray-900/10",
                      )}
                    >
                      <DownloadIcon className="size-3" />
                      {download.label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </BrandSection>

        <BrandSection title="颜色">
          <BrandText>
            我们的蓝色取自应用图标的渐变色，请搭配墨色和白色使用。
          </BrandText>
          <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
            {colors.map((color) => (
              <div key={color.hex}>
                <div
                  className="h-24 rounded-2xl border border-gray-200"
                  style={{ backgroundColor: color.hex }}
                />
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-gray-900 text-sm">
                      {color.name}
                    </div>
                    <div className="font-mono text-gray-500 text-xs">
                      {color.hex}
                    </div>
                  </div>
                  <CopyButton
                    value={color.hex}
                    label={`复制${color.name}色值`}
                    iconOnly
                  />
                </div>
              </div>
            ))}
          </div>
        </BrandSection>

        <BrandSection title="截图">
          <BrandText>
            展示 Inbox Zero
            时请使用这张产品截图。截图使用演示数据，未显示任何真实收件箱。
          </BrandText>
          <a
            href={SCREENSHOT_SRC}
            download="inbox-zero-screenshot.webp"
            className="mt-6 block overflow-hidden rounded-2xl border border-gray-200"
          >
            <Image
              src={SCREENSHOT_SRC}
              alt="桌面端和移动端的 Inbox Zero Mail"
              width={2540}
              height={1520}
              className="h-auto w-full"
            />
          </a>
        </BrandSection>

        <BrandSection title="简介">
          <BrandText>撰写关于我们的内容时请使用这段简介。</BrandText>
          <div className="mt-4 flex flex-col items-start gap-4 rounded-2xl border border-gray-200 p-6">
            <Paragraph color="dark">{BOILERPLATE}</Paragraph>
            <CopyButton value={BOILERPLATE} label="复制文本" />
          </div>
        </BrandSection>

        <BrandSection title="问题咨询">
          <BrandText>
            如需其他资源，或对 Inbox Zero 品牌的使用有疑问，请{" "}
            <a
              href={`mailto:${env.NEXT_PUBLIC_SUPPORT_EMAIL}`}
              className="font-medium text-gray-900 underline underline-offset-4"
            >
              联系我们
            </a>{" "}
            。
          </BrandText>
        </BrandSection>
      </div>

      <FinalCTA />
      <Footer />
    </>
  );
}

function BrandSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-20">
      <h2 className="font-title text-2xl text-gray-900">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function BrandText({ children }: { children: React.ReactNode }) {
  return (
    <Paragraph color="gray-500" className="mt-2 first:mt-0">
      {children}
    </Paragraph>
  );
}

function AppIcon({ size }: { size: number }) {
  return (
    <Image
      src="/brand/inbox-zero-icon.png"
      alt="Inbox Zero app icon"
      width={size}
      height={size}
    />
  );
}
