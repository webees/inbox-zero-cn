import {
  RocketIcon,
  BriefcaseIcon,
  StoreIcon,
  CodeIcon,
  CalendarDaysIcon,
  TrendingUpIcon,
  PhoneIcon,
  MegaphoneIcon,
  HeadphonesIcon,
  HomeIcon,
  VideoIcon,
  UsersIcon,
  ShoppingCartIcon,
  GraduationCapIcon,
  UserIcon,
  CircleHelpIcon,
  type LucideIcon,
} from "lucide-react";

export const usersRolesInfo: Record<
  string,
  {
    icon: LucideIcon;
    suggestedLabels: { label: string; description: string }[];
  }
> = {
  Founder: {
    icon: RocketIcon,
    suggestedLabels: [
      {
        label: "客户反馈",
        description: "我们收到的客户反馈和建议",
      },
      {
        label: "投资者",
        description: "来自投资者和风投的沟通",
      },
      {
        label: "紧急",
        description: "需要立即处理的时间敏感邮件",
      },
    ],
  },
  Executive: {
    icon: BriefcaseIcon,
    suggestedLabels: [
      {
        label: "董事会",
        description: "董事会会议、材料和董事沟通",
      },
      {
        label: "关键利益相关者",
        description: "重要合作伙伴、主要客户和 VIP 沟通",
      },
    ],
  },
  "Small Business Owner": {
    icon: StoreIcon,
    suggestedLabels: [
      {
        label: "客户反馈",
        description: "我们收到的客户反馈和建议",
      },
      {
        label: "紧急",
        description: "需要立即处理的时间敏感邮件",
      },
    ],
  },
  "Software Engineer": {
    icon: CodeIcon,
    suggestedLabels: [
      {
        label: "警报",
        description: "服务器错误和部署通知",
      },
      {
        label: "GitHub",
        description: "拉取请求和代码审查",
      },
      {
        label: "缺陷",
        description: "缺陷报告和问题跟踪",
      },
      {
        label: "安全",
        description: "安全漏洞和更新",
      },
    ],
  },
  Assistant: {
    icon: CalendarDaysIcon,
    suggestedLabels: [
      {
        label: "安排会议",
        description: "需要安排会议的邮件",
      },
      {
        label: "出差",
        description: "差旅安排和行程",
      },
    ],
  },
  Investor: {
    icon: TrendingUpIcon,
    suggestedLabels: [
      {
        label: "公司动态",
        description: "投资组合公司的进展报告",
      },
      {
        label: "路演 PPT",
        description: "创业公司推介和投资机会",
      },
      {
        label: "有限合伙人",
        description: "有限合伙人沟通",
      },
      {
        label: "尽职调查",
        description: "投资研究和分析",
      },
    ],
  },
  Sales: {
    icon: PhoneIcon,
    suggestedLabels: [
      {
        label: "潜在客户",
        description: "潜在客户和销售线索",
      },
      {
        label: "客户",
        description: "现有客户的沟通",
      },
      {
        label: "交易洽谈",
        description: "进行中的谈判和提案",
      },
      {
        label: "流失风险",
        description: "显示出取消迹象的客户",
      },
    ],
  },
  Marketing: {
    icon: MegaphoneIcon,
    suggestedLabels: [
      {
        label: "营销活动",
        description: "营销活动和推广活动",
      },
      {
        label: "内容审核",
        description: "需要审批或反馈的内容草稿",
      },
      {
        label: "分析报告",
        description: "绩效指标和营销分析",
      },
      {
        label: "合作伙伴/代理商",
        description: "与营销代理商和合作伙伴的沟通",
      },
    ],
  },
  "Customer Support": {
    icon: HeadphonesIcon,
    suggestedLabels: [
      {
        label: "支持工单",
        description: "客户就我们的产品或服务寻求帮助的请求",
      },
      {
        label: "缺陷",
        description: "客户提交的缺陷报告",
      },
      {
        label: "功能请求",
        description: "客户对新功能的建议",
      },
    ],
  },
  Realtor: {
    icon: HomeIcon,
    suggestedLabels: [
      {
        label: "买家线索",
        description: "咨询房产的潜在购房者",
      },
      {
        label: "卖家线索",
        description: "有意出售的房产业主",
      },
      {
        label: "看房请求",
        description: "预约看房的请求",
      },
      {
        label: "交割",
        description: "房产交割的文件和沟通",
      },
    ],
  },
  "Content Creator": {
    icon: VideoIcon,
    suggestedLabels: [
      {
        label: "赞助",
        description: "品牌赞助咨询和合作",
      },
      {
        label: "合作",
        description: "其他创作者的合作请求",
      },
      {
        label: "品牌合作",
        description: "与品牌的合作机会",
      },
      {
        label: "媒体",
        description: "媒体咨询和采访请求",
      },
    ],
  },
  Consultant: {
    icon: UsersIcon,
    suggestedLabels: [
      {
        label: "客户项目",
        description: "进行中的客户合作和项目进展",
      },
      {
        label: "提案",
        description: "新业务提案和 RFP 回复",
      },
      {
        label: "职业人脉",
        description: "行业联系人和推荐机会",
      },
    ],
  },
  "E-commerce": { icon: ShoppingCartIcon, suggestedLabels: [] },
  Student: {
    icon: GraduationCapIcon,
    suggestedLabels: [
      {
        label: "学校",
        description: "来自教授和教职员工的邮件",
      },
      {
        label: "作业",
        description: "作业和项目截止日期",
      },
      {
        label: "实习",
        description: "实习机会和申请",
      },
      {
        label: "学习资料",
        description: "课堂笔记和学习资源",
      },
    ],
  },
  Individual: { icon: UserIcon, suggestedLabels: [] },
  Other: { icon: CircleHelpIcon, suggestedLabels: [] },
};
