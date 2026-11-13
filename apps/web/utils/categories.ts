export const defaultCategory = {
  // 主要类别 - 用于规则和批量归档 UI
  OTHER: {
    name: "其他",
    enabled: true,
    description: "不符合任何其他类别的发件人",
  },
  NEWSLETTER: {
    name: "订阅简报",
    enabled: true,
    description: "定期发送的编辑内容、邮件摘要和信息更新",
  },
  MARKETING: {
    name: "营销推广",
    enabled: true,
    description: "推广内容、产品发布和营销活动",
  },
  RECEIPT: {
    name: "收据",
    enabled: true,
    description: "购买确认、订单收据和付款确认",
  },
  NOTIFICATION: {
    name: "通知",
    enabled: true,
    description: "自动提醒、系统通知和状态更新",
  },
  // TODO: 未来两轮分类的次要类别
  // 这些类别会为分析目的进一步细分 "Other" 发件人。
  // 实现方式：主分类完成后，如果结果是 "Other"，
  // 再用仅包含次要类别的第二次 AI 调用。
  // 参见：ai-categorize-senders.ts 中的 aiCategorizeSendersTwoRound（已注释掉）
  //
  // BANKING: { name: "Banking", enabled: false, description: "金融机构、银行和支付服务" },
  // LEGAL: { name: "Legal", enabled: false, description: "法律通知、合同和法律通信" },
  // INVESTOR: { name: "Investor", enabled: false, description: "风投、股票提醒、投资组合更新、股权管理工具" },
  // PERSONAL: { name: "Personal", enabled: false, description: "来自朋友和家人的私人通信" },
  // WORK: { name: "Work", enabled: false, description: "职业联系人和工作相关的通信" },
  // TRAVEL: { name: "Travel", enabled: false, description: "航空公司、酒店、预订服务" },
  // SUPPORT: { name: "Support", enabled: false, description: "客户服务与支持" },
  // EVENTS: { name: "Events", enabled: false, description: "活动邀请和提醒" },
  // EDUCATIONAL: { name: "Educational", enabled: false, description: "教育机构和课程" },
  // HEALTH: { name: "Health", enabled: false, description: "医疗机构和医疗服务" },
  // GOVERNMENT: { name: "Government", enabled: false, description: "政府机构和官方通信" },
} as const;

export type SenderCategoryKey = keyof typeof defaultCategory;
export type SenderCategoryValue = (typeof defaultCategory)[SenderCategoryKey];
export type SenderCategory = SenderCategoryValue["name"];
