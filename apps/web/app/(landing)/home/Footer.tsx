import type { ComponentProps } from "react";
import Link from "next/link";
import { env } from "@/env";
import { EXTENSION_URL } from "@/utils/config";
import { BRAND_NAME } from "@/utils/branding";
import { CookieSettingsButton } from "@/components/CookieConsent";

export const footerNavigation = {
  main: [
    {
      name: `${BRAND_NAME} Tabs（Chrome 扩展）`,
      href: EXTENSION_URL,
      target: "_blank",
    },
    { name: "AI 邮件助手", href: "/ai-automation" },
    { name: "邮件应用", href: "/email-client" },
    { name: "移动应用", href: "/mobile-app" },
    { name: "下载", href: "/download" },
    { name: "Slack 与 Telegram 的 AI 聊天", href: "/ai-assistant-chat" },
    { name: "Slack AI 助手", href: "/slack-integration" },
    { name: "Telegram AI 助手", href: "/telegram-integration" },
    { name: "Teams AI 助手", href: "/teams-integration" },
    { name: "会议简报", href: "/brief-my-meeting" },
    { name: "AI 会议记录", href: "/ai-meeting-notetaker" },
    { name: "Reply Zero", href: "/reply-zero-ai" },
    { name: "批量邮件退订", href: "/bulk-email-unsubscriber" },
    { name: "清理你的收件箱", href: "/clean-inbox" },
    { name: "冷邮件拦截器", href: "/block-cold-emails" },
    { name: "邮件分析", href: "/email-analytics" },
    { name: "自动转发邮件", href: "/auto-forward-emails" },
    { name: "自动归档附件", href: "/auto-file-email-attachments" },
    { name: "开源", href: "/github", target: "_blank" },
  ],
  useCases: [
    { name: "创始人", href: "/founders" },
    { name: "小型企业", href: "/small-business" },
    { name: "内容创作者", href: "/creator" },
    { name: "房地产经纪人", href: "/real-estate" },
    { name: "客户支持", href: "/customer-support" },
    { name: "电子商务", href: "/ecommerce" },
  ],
  industries: [
    { name: "MSPs", href: "/msp" },
    { name: "物业管理", href: "/property-management" },
    { name: "律师事务所", href: "/law-firms" },
    { name: "会计师事务所", href: "/accounting-firms" },
  ],
  compare: [
    {
      name: "最佳 AI 邮件助手",
      href: "/blog/post/best-ai-email-assistants",
    },
    {
      name: "AI 邮件助手目录",
      href: "https://aiemailassistants.com",
      target: "_blank",
    },
    { name: "对比 Fyxer.ai", href: "/best-fyxer-alternative" },
    { name: "对比 Superhuman", href: "/best-superhuman-alternative" },
    { name: "对比 Shortwave", href: "/best-shortwave-alternative" },
    {
      name: "对比 Perplexity 邮件助手",
      href: "/best-perplexity-email-assistant-alternative",
    },
  ],
  tools: [
    { name: "所有免费邮件工具", href: "/tools" },
    {
      name: "邮件送达率检查器",
      href: "/tools/email-deliverability-checker",
    },
    { name: "Gmail 性格测试", href: "/tools/gmail-quiz" },
    { name: "主题行分析器", href: "/tools/subject-line-analyzer" },
    {
      name: "邮件签名生成器",
      href: "/tools/email-signature-generator",
    },
    { name: "会议成本计算器", href: "/tools/meeting-cost-calculator" },
    {
      name: "团队邮件成本计算器",
      href: "/tools/email-cost-calculator",
    },
  ],
  support: [
    { name: "定价", href: "/pricing" },
    { name: "支持", href: "/support" },
    { name: "联系我们", href: `mailto:${env.NEXT_PUBLIC_SUPPORT_EMAIL}` },
    {
      name: "文档",
      href: "https://docs.getinboxzero.com",
      target: "_blank",
    },
    { name: "功能请求", href: "/feature-requests", target: "_blank" },
    { name: "更新日志", href: "/changelog", target: "_blank" },
    {
      name: "状态",
      href: "https://inbox-zero.openstatus.dev/",
      target: "_blank",
    },
    { name: "CLI", href: "/cli" },
    { name: "OpenClaw 技能", href: "/openclaw" },
  ],
  company: [
    { name: "关于", href: "/about" },
    { name: "联盟计划", href: "/affiliates", target: "_blank" },
    { name: "博客", href: "/blog" },
    { name: "案例研究", href: "/case-studies" },
    { name: "Twitter", href: "/twitter", target: "_blank" },
    { name: "GitHub", href: "/github", target: "_blank" },
    { name: "Discord", href: "/discord", target: "_blank" },
    { name: "开源伙伴", href: "/oss-friends" },
    { name: "邮件轰炸", href: "/game" },
    {
      name: "机器人目录",
      href: "https://botdirectory.ai",
      target: "_blank",
    },
    { name: "Rakazo", href: "https://rakazo.com", target: "_blank" },
  ],
  legal: [
    { name: "条款", href: "/terms" },
    { name: "隐私", href: "/privacy" },
    {
      name: "符合 SOC2",
      href: "https://security.getinboxzero.com",
      target: "_blank",
    },
  ],
  social: [
    {
      name: "Twitter",
      href: "/twitter",
      target: "_blank",
      icon: (props: ComponentProps<"svg">) => (
        <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
          <title>Twitter</title>
          <path d="M8.29 20.251c7.547 0 11.675-6.253 11.675-11.675 0-.178 0-.355-.012-.53A8.348 8.348 0 0022 5.92a8.19 8.19 0 01-2.357.646 4.118 4.118 0 001.804-2.27 8.224 8.224 0 01-2.605.996 4.107 4.107 0 00-6.993 3.743 11.65 11.65 0 01-8.457-4.287 4.106 4.106 0 001.27 5.477A4.072 4.072 0 012.8 9.713v.052a4.105 4.105 0 003.292 4.022 4.095 4.095 0 01-1.853.07 4.108 4.108 0 003.834 2.85A8.233 8.233 0 012 18.407a11.616 11.616 0 006.29 1.84" />
        </svg>
      ),
    },
    {
      name: "GitHub",
      href: "/github",
      target: "_blank",
      icon: (props: ComponentProps<"svg">) => (
        <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
          <title>GitHub</title>
          <path
            fillRule="evenodd"
            d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
            clipRule="evenodd"
          />
        </svg>
      ),
    },
    {
      name: "Discord",
      href: "/discord",
      target: "_blank",
      icon: (props: ComponentProps<"svg">) => (
        <svg fill="currentColor" viewBox="0 0 48 48" {...props}>
          <title>Discord</title>
          <path d="M40,12c0,0-4.585-3.588-10-4l-0.488,0.976C34.408,10.174,36.654,11.891,39,14c-4.045-2.065-8.039-4-15-4s-10.955,1.935-15,4c2.346-2.109,5.018-4.015,9.488-5.024L18,8c-5.681,0.537-10,4-10,4s-5.121,7.425-6,22c5.162,5.953,13,6,13,6l1.639-2.185C13.857,36.848,10.715,35.121,8,32c3.238,2.45,8.125,5,16,5s12.762-2.55,16-5c-2.715,3.121-5.857,4.848-8.639,5.815L33,40c0,0,7.838-0.047,13-6C45.121,19.425,40,12,40,12z M17.5,30c-1.933,0-3.5-1.791-3.5-4c0-2.209,1.567-4,3.5-4s3.5,1.791,3.5,4C21,28.209,19.433,30,17.5,30z M30.5,30c-1.933,0-3.5-1.791-3.5-4c0-2.209,1.567-4,3.5-4s3.5,1.791,3.5,4C34,28.209,32.433,30,30.5,30z" />
        </svg>
      ),
    },
  ],
};

// 自托管部署使用的简洁页脚
const selfHostedFooter = {
  resources: [
    {
      name: "文档",
      href: "https://docs.getinboxzero.com",
      target: "_blank",
    },
    { name: "联系我们", href: `mailto:${env.NEXT_PUBLIC_SUPPORT_EMAIL}` },
    { name: "GitHub", href: "/github", target: "_blank" },
    { name: "Discord", href: "/discord", target: "_blank" },
  ],
  legal: [
    { name: "条款", href: "/terms" },
    { name: "隐私", href: "/privacy" },
  ],
};

export function Footer() {
  const copyrightName =
    BRAND_NAME === "Inbox Zero" ? "Inbox Zero Inc." : BRAND_NAME;

  if (env.NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS) {
    return (
      <footer className="relative">
        <div className="mx-auto max-w-7xl overflow-hidden px-6 py-12 lg:px-8">
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            {selfHostedFooter.resources.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                target={item.target}
                rel={
                  item.target === "_blank" ? "noopener noreferrer" : undefined
                }
                className="text-sm leading-6 text-gray-600 hover:text-gray-900"
              >
                {item.name}
              </Link>
            ))}
            <span className="text-gray-300">|</span>
            {selfHostedFooter.legal.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className="text-sm leading-6 text-gray-600 hover:text-gray-900"
              >
                {item.name}
              </Link>
            ))}
            <CookieSettingsButton className="text-sm leading-6 text-gray-600 hover:text-gray-900" />
          </div>
          <p className="mt-6 text-center text-xs leading-5 text-gray-500">
            由{" "}
            <Link
              href="https://getinboxzero.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-900"
            >
              Inbox Zero
            </Link>{" "}
            提供支持
          </p>
        </div>
      </footer>
    );
  }

  return (
    <footer className="relative">
      <div className="mx-auto max-w-7xl overflow-hidden px-6 py-20 sm:py-24 lg:px-8">
        <nav aria-label="页脚">
          <div className="mt-16 grid grid-cols-2 gap-8 lg:grid-cols-5 xl:col-span-2 xl:mt-0">
            <div>
              <FooterList title="产品" items={footerNavigation.main} />
            </div>
            <div>
              <FooterList title="用例" items={footerNavigation.useCases} />

              <div className="mt-6">
                <FooterList title="行业" items={footerNavigation.industries} />
              </div>

              <div className="mt-6">
                <FooterList title="对比" items={footerNavigation.compare} />
              </div>
            </div>
            <div>
              <FooterList title="支持" items={footerNavigation.support} />

              <div className="mt-6">
                <FooterList title="免费工具" items={footerNavigation.tools} />
              </div>
            </div>
            <div>
              <FooterList title="公司" items={footerNavigation.company} />
            </div>
            <div>
              <FooterList title="法律" items={footerNavigation.legal} />
              <CookieSettingsButton className="mt-4 text-sm leading-6 text-gray-600 hover:text-gray-900" />
            </div>
          </div>
        </nav>

        <div className="mt-16 flex justify-center space-x-10">
          {footerNavigation.social.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className="text-gray-400 hover:text-gray-500"
            >
              <span className="sr-only">{item.name}</span>
              <item.icon className="h-6 w-6" aria-hidden="true" />
            </Link>
          ))}
        </div>
        <p className="mt-10 text-center text-xs leading-5 text-gray-500">
          &copy; {new Date().getFullYear()} {copyrightName}. 保留所有权利。
        </p>
      </div>
    </footer>
  );
}

function FooterList(props: {
  title: string;
  items: { name: string; href: string; target?: string }[];
}) {
  return (
    <>
      <h3 className="text-sm font-semibold leading-6 text-gray-900">
        {props.title}
      </h3>
      <ul className="mt-6 space-y-4">
        {props.items.map((item) => (
          <li key={item.name}>
            <Link
              href={item.href}
              target={item.target}
              prefetch={false}
              className="text-sm leading-6 text-gray-600 hover:text-gray-900"
            >
              {item.name}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
