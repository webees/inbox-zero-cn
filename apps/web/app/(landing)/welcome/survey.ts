// 从 PostHog 复制而来
import { USER_ROLES } from "@/utils/constants/user-roles";
import { BRAND_NAME } from "@/utils/branding";

export const survey = {
  questions: [
    {
      key: "features",
      type: "multiple_choice",
      question: "你最感兴趣的功能有哪些？",
      choices: [
        "AI 个人助手",
        "批量退订",
        "冷邮件拦截器",
        "回复/跟进追踪器",
        "邮件分析",
      ],
    },
    {
      key: "role",
      type: "single_choice",
      question: "哪个角色最能描述你？",
      choices: USER_ROLES.map((role) => role.value),
      skippable: true,
    },
    {
      key: "goal",
      type: "single_choice",
      question: `你希望借助 ${BRAND_NAME} 达成什么目标？`,
      choices: ["清理我现有的邮件", "更好地管理日后的收件箱", "两者都要"],
    },
    // {
    //   key: "company_size",
    //   type: "single_choice",
    //   question: "你的公司规模有多大？",
    //   choices: [
    //     "只有我",
    //     "2-10 人",
    //     "11-100 人",
    //     "101-1000 人",
    //     "1000+ 人",
    //   ],
    //   skippable: false,
    // },
    {
      key: "source",
      type: "single_choice",
      question: `你是如何听说 ${BRAND_NAME} 的？`,
      choices: [
        "搜索",
        "朋友",
        "Twitter",
        "GitHub",
        "YouTube",
        "Reddit",
        "Facebook",
        "邮件简报",
        "Product Hunt",
        "HackerNews",
        "TikTok",
        "Instagram",
        "其他",
      ],
      skippable: true,
    },
    {
      key: "improvements",
      type: "open",
      question:
        "最后一个问题！如果你有一根魔法棒，你希望改善邮件体验的哪一点？",
    },
  ],
};
