"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  SparklesIcon,
  BarChartBigIcon,
  SettingsIcon,
  UserIcon,
  ScrollTextIcon,
  UsersIcon,
  ShieldCheckIcon,
  CalendarIcon,
  FileTextIcon,
  BrushIcon,
  ZapIcon,
  InboxIcon,
  MailsIcon,
} from "lucide-react";
import type { Command } from "@/lib/commands/types";
import { useSettingsDialog } from "@/hooks/useSettingsDialog";
import { useRules } from "@/hooks/useRules";
import { useAccount } from "@/providers/EmailAccountProvider";
import { prefixPath } from "@/utils/path";
import {
  useCleanerEnabled,
  useIntegrationsEnabled,
  useMeetingBriefsEnabled,
} from "@/hooks/useFeatureFlags";
import { isGoogleProvider } from "@/utils/email/provider-types";

export function useCommandPaletteCommands({
  enabled = true,
}: {
  enabled?: boolean;
} = {}) {
  const router = useRouter();
  const { openSettings } = useSettingsDialog();
  const { emailAccountId, provider } = useAccount();
  const { data: rulesData, isLoading: rulesLoading } = useRules(
    undefined,
    enabled,
  );
  const showCleaner = useCleanerEnabled();
  const showMeetingBriefs = useMeetingBriefsEnabled();
  const showIntegrations = useIntegrationsEnabled();

  const commands = useMemo<Command[]>(() => {
    const generalSettingsCommands: Command[] = [
      {
        id: "settings-general",
        label: "设置",
        description: "通用账号设置",
        icon: SettingsIcon,
        section: "settings",
        priority: 1,
        keywords: ["settings", "preferences", "configuration"],
        action: () => {
          openSettings();
        },
      },
    ];
    if (!enabled) return generalSettingsCommands;

    const navigationItems = [
      {
        name: "邮件",
        href: prefixPath(emailAccountId, "/mail"),
        icon: InboxIcon,
        keywords: ["mail", "inbox", "email"],
      },
      {
        name: "助手",
        href: prefixPath(emailAccountId, "/automation"),
        icon: SparklesIcon,
        keywords: ["ai", "assistant", "rules", "auto"],
      },
      {
        name: "批量退订",
        href: prefixPath(emailAccountId, "/bulk-unsubscribe"),
        icon: MailsIcon,
        keywords: ["unsubscribe", "newsletters", "spam"],
      },
      {
        name: "数据分析",
        href: prefixPath(emailAccountId, "/stats"),
        icon: BarChartBigIcon,
        keywords: ["statistics", "charts", "data"],
      },
      {
        name: "日历",
        href: prefixPath(emailAccountId, "/calendars"),
        icon: CalendarIcon,
        keywords: ["calendar", "scheduling", "meetings"],
      },
      ...(showIntegrations
        ? [
            {
              name: "集成",
              href: prefixPath(emailAccountId, "/integrations"),
              icon: ZapIcon,
              keywords: ["integrations", "apps", "connect"],
            },
          ]
        : []),
      ...(showMeetingBriefs
        ? [
            {
              name: "会议简报",
              href: prefixPath(emailAccountId, "/briefs"),
              icon: FileTextIcon,
              keywords: ["briefs", "meeting", "summaries"],
            },
          ]
        : []),
      ...(isGoogleProvider(provider) && showCleaner
        ? [
            {
              name: "深度清理",
              href: prefixPath(emailAccountId, "/clean"),
              icon: BrushIcon,
              keywords: ["clean", "organize", "tidy"],
            },
          ]
        : []),
      {
        name: "冷邮件拦截器",
        href: prefixPath(emailAccountId, "/cold-email-blocker"),
        icon: ShieldCheckIcon,
        keywords: ["block", "cold", "spam", "filter"],
      },
    ];
    const navigationCommands: Command[] = navigationItems.map(
      (item, index) => ({
        id: `nav-${item.name.toLowerCase().replace(/\s+/g, "-")}`,
        label: `前往 ${item.name}`,
        icon: item.icon,
        section: "navigation",
        priority: index + 10,
        keywords: [item.name.toLowerCase(), ...item.keywords],
        action: () => router.push(item.href),
      }),
    );

    const settingsCommands: Command[] = [
      {
        id: "settings-assistant",
        label: "助手设置",
        description: "配置 AI 助手行为",
        icon: SparklesIcon,
        section: "settings",
        priority: 2,
        keywords: ["ai", "assistant", "automation"],
        action: () =>
          router.push(prefixPath(emailAccountId, "/assistant/settings")),
      },
      {
        id: "settings-usage",
        label: "用量",
        description: "查看用量统计",
        icon: BarChartBigIcon,
        section: "settings",
        priority: 3,
        keywords: ["usage", "stats", "limits"],
        action: () => router.push(prefixPath(emailAccountId, "/usage")),
      },
      {
        id: "settings-organization",
        label: "组织",
        description: "管理组织设置",
        icon: UsersIcon,
        section: "settings",
        priority: 4,
        keywords: ["org", "team", "organization"],
        action: () => router.push(prefixPath(emailAccountId, "/organization")),
      },
      {
        id: "manage-accounts",
        label: "管理账号",
        description: "添加或切换邮箱账号",
        icon: UserIcon,
        section: "settings",
        priority: 5,
        keywords: ["accounts", "email", "switch"],
        action: () => router.push("/accounts"),
      },
    ];

    const ruleCommands: Command[] = (rulesData ?? []).map((rule, index) => ({
      id: `rule-${rule.id}`,
      label: rule.name,
      description: rule.instructions || "查看规则",
      icon: ScrollTextIcon,
      section: "rules" as const,
      priority: index + 1,
      keywords: ["rule", rule.name.toLowerCase()],
      action: () =>
        router.push(prefixPath(emailAccountId, `/assistant/rule/${rule.id}`)),
    }));

    return [
      ...navigationCommands,
      ...generalSettingsCommands,
      ...settingsCommands,
      ...ruleCommands,
    ];
  }, [
    emailAccountId,
    enabled,
    provider,
    openSettings,
    router,
    rulesData,
    showCleaner,
    showIntegrations,
    showMeetingBriefs,
  ]);

  return {
    commands,
    isLoading: enabled && rulesLoading,
  };
}
