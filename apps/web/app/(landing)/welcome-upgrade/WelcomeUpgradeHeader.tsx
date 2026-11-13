"use client";

import { CheckCircleIcon } from "lucide-react";
import { userCount } from "@/utils/config";
import { BRAND_NAME } from "@/utils/branding";

export function WelcomeUpgradeHeader() {
  return (
    <div className="mb-6 flex flex-col items-start sm:mb-8">
      <div className="mx-auto text-center">
        <h2 className="font-title text-sm leading-6 text-blue-600 sm:text-base sm:leading-7">
          在邮件上少花一半时间
        </h2>
        <div>
          <h1 className="mt-1 font-title text-2xl text-gray-900 sm:mt-2 sm:text-3xl">
            开始 7 天免费试用
          </h1>
          <p className="mt-2 text-base text-gray-900 sm:text-xl">
            {`加入 ${userCount} 位使用 ${BRAND_NAME} 提升效率的用户！`}
          </p>
        </div>
      </div>

      <div className="mx-auto mt-3 flex flex-col items-start gap-1.5 sm:mt-4 sm:gap-2">
        <TrialFeature>100% 零风险试用</TrialFeature>
        <TrialFeature>前 7 天免费</TrialFeature>
        <TrialFeature>随时取消，无后顾之忧</TrialFeature>
      </div>
    </div>
  );
}

const TrialFeature = ({ children }: { children: React.ReactNode }) => (
  <p className="flex items-center text-sm text-gray-900 sm:text-base">
    <CheckCircleIcon className="mr-2 h-4 w-4 text-green-500" />
    {children}
  </p>
);
