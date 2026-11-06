"use client";

import Link from "next/link";
import {
  HomeIcon,
  UserIcon,
  RocketIcon,
  BuildingIcon,
  HeadphonesIcon,
  ShoppingCartIcon,
} from "lucide-react";
import { cn } from "@/utils";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";

const navigation = [
  { name: "企业版", href: "/enterprise" },
  { name: "案例研究", href: "/case-studies" },
  { name: "定价", href: "/pricing" },
];

const useCases = [
  {
    title: "创始人",
    href: "/founders",
    description: "在 AI 处理你收件箱的同时扩展你的创业公司",
    icon: RocketIcon,
    iconColor: "text-new-purple-600",
    borderColor: "from-new-purple-200 to-new-purple-300",
    gradient: "from-new-purple-50 to-new-purple-100",
    hoverBg: "hover:bg-new-purple-50/[0.44]",
  },
  {
    title: "小型企业",
    href: "/small-business",
    description: "用自动化的邮件管理发展你的业务",
    icon: BuildingIcon,
    iconColor: "text-new-green-500",
    borderColor: "from-new-green-150 to-new-green-200",
    gradient: "from-new-green-50 to-new-green-100",
    hoverBg: "hover:bg-new-green-50",
  },
  {
    title: "内容创作者",
    href: "/creator",
    description: "简化品牌合作与协作流程",
    icon: UserIcon,
    iconColor: "text-new-blue-600",
    borderColor: "from-new-blue-150 to-new-blue-200",
    gradient: "from-new-blue-50 to-new-blue-100",
    hoverBg: "hover:bg-new-blue-50/50",
  },
  {
    title: "房地产",
    href: "/real-estate",
    description: "面向房地产专业人士的 AI 邮件管理",
    icon: HomeIcon,
    iconColor: "text-new-pink-500",
    borderColor: "from-new-pink-150 to-new-pink-200",
    gradient: "from-new-pink-50 to-new-pink-100",
    hoverBg: "hover:bg-new-pink-50/[0.44]",
  },
  {
    title: "客户支持",
    href: "/customer-support",
    description: "用 AI 驱动的回复提供更快的支持",
    icon: HeadphonesIcon,
    iconColor: "text-new-orange-600",
    borderColor: "from-new-orange-150 to-new-orange-200",
    gradient: "from-new-orange-50 to-new-orange-100",
    hoverBg: "hover:bg-new-orange-50/50",
  },
  {
    title: "电子商务",
    href: "/ecommerce",
    description: "自动化订单更新和客户沟通",
    icon: ShoppingCartIcon,
    iconColor: "text-new-indigo-600",
    borderColor: "from-new-indigo-150 to-new-indigo-200",
    gradient: "from-new-indigo-50 to-new-indigo-100",
    hoverBg: "hover:bg-new-indigo-50/50",
  },
];

export function HeaderLinks() {
  return (
    <div className="hidden lg:flex lg:items-center lg:gap-x-8">
      <NavigationMenu>
        <NavigationMenuList>
          {/* Solutions Dropdown */}
          <NavigationMenuItem>
            <NavigationMenuTrigger className="text-sm font-semibold font-geist leading-6 text-gray-900">
              解决方案
            </NavigationMenuTrigger>
            <NavigationMenuContent>
              <ul className="grid w-[640px] grid-cols-2 gap-2 p-4">
                {useCases.map((useCase) => (
                  <EnhancedListItem
                    key={useCase.title}
                    title={useCase.title}
                    href={useCase.href}
                    icon={useCase.icon}
                    iconColor={useCase.iconColor}
                    gradient={useCase.gradient}
                    borderColor={useCase.borderColor}
                    hoverBg={useCase.hoverBg}
                  >
                    {useCase.description}
                  </EnhancedListItem>
                ))}
              </ul>
            </NavigationMenuContent>
          </NavigationMenuItem>

          {/* Regular Navigation Items */}
          {navigation.map((item) => (
            <NavigationMenuItem key={item.name}>
              <NavigationMenuLink
                asChild
                className={navigationMenuTriggerStyle()}
              >
                <Link
                  href={item.href}
                  className="text-sm font-semibold font-geist leading-6 text-gray-900"
                >
                  {item.name}
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
          ))}
        </NavigationMenuList>
      </NavigationMenu>
    </div>
  );
}

function EnhancedListItem({
  title,
  children,
  href,
  icon: Icon,
  iconColor,
  gradient,
  borderColor,
  hoverBg,
  ...props
}: React.ComponentPropsWithoutRef<"li"> & {
  href: string;
  // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
  icon: React.ComponentType<any>;
  iconColor: string;
  gradient: string;
  borderColor: string;
  hoverBg: string;
}) {
  return (
    <li {...props}>
      <NavigationMenuLink asChild>
        <Link
          href={href}
          className={cn(
            "group block select-none space-y-1 rounded-xl p-4 leading-none no-underline outline-none transition-all duration-200 focus:bg-accent focus:text-accent-foreground",
            hoverBg,
          )}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "p-px rounded-lg shadow-sm bg-gradient-to-b",
                borderColor,
              )}
            >
              <div
                className={cn(
                  "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[7px] bg-gradient-to-b shadow-sm transition-transform",
                  gradient,
                )}
              >
                <Icon className={cn("h-4 w-4", iconColor)} />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-none text-gray-900 group-hover:text-gray-800">
                {title}
              </div>
              <p className="mt-1 text-sm leading-snug text-gray-600 group-hover:text-gray-700">
                {children}
              </p>
            </div>
          </div>
        </Link>
      </NavigationMenuLink>
    </li>
  );
}
