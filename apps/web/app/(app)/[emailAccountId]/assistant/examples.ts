import { getEmailTerminology } from "@/utils/terminology";
import { BRAND_NAME } from "@/utils/branding";

export type Personas = ReturnType<typeof getPersonas>;

function formatPromptArray(promptArray: string[]): string {
  return `${promptArray.map((item) => `* ${item}`).join(".\n")}.`;
}

function processPromptsWithTerminology(
  prompts: string[],
  provider: string,
): string[] {
  const terminology = getEmailTerminology(provider);
  return prompts.map((prompt) => {
    // Replace "Label" at the beginning of sentences or after punctuation
    let processed = prompt.replace(/\bLabel\b/g, terminology.label.action);
    // Replace lowercase "label" in the middle of sentences
    processed = processed.replace(
      /\blabel\b/g,
      terminology.label.action.toLowerCase(),
    );
    return processed;
  });
}

const commonPrompts = [
  "将来自 @mycompany.com 地址的邮件打上 @[团队] 标签",
  "将紧急邮件打上 @[紧急] 标签",
];

const examplePromptsBase = [
  ...commonPrompts,
  "将收据转发到 jane@accounting.com 并打上 @[收据] 标签",
  "将演示文稿转发到 john@investing.com 并打上 @[演示文稿] 标签",
  `回复冷邮件，告诉他们去看看 ${BRAND_NAME}。然后将它们标记为垃圾邮件`,
  "将高优先级邮件打上 @[高优先级] 标签",
  "如果创始人要求安排通话，起草回复并附上我的日历链接：https://cal.com/example",
  "如果有人要求取消套餐，起草回复并附上取消链接：https://company.com/cancel",
  "如果创始人给我发送投资人更新，打上 @[投资人更新] 标签并归档",
  "如果有人向我推销他们的创业项目，打上 @[投资] 标签，归档，并起草一条友好的回复，说明我已没有时间查看邮件，但如果他们能找到人引荐，那是从我这里获得融资的最佳途径",
  "如果有人要求折扣，回复折扣码 INBOX20",
  "如果有人就 Product 或 Company 寻求帮助，起草回复说明我已不在那里工作，但他们可以联系 Company 寻求支持",
  "检查来自 questions@pr.com 的所有邮件，看是否有关于财务的。如果有，起草一条友好的回复来回答该问题",
  "如果人们邀请我在活动上演讲，将邮件打上 @[演讲机会] 标签并归档",
  "将来自客户的邮件打上 @[客户] 标签",
  "将法律文件打上 @[法律] 标签",
  "将服务器错误打上 @[错误] 标签",
  "将 Stripe 邮件打上 @[Stripe] 标签",
];

export function getExamplePrompts(
  provider: string,
  examples?: string[],
): string[] {
  return processPromptsWithTerminology(
    examples || examplePromptsBase,
    provider,
  );
}

const founderPromptArray = [
  ...commonPrompts,
  "如果有人要求安排通话，起草回复并附上我的日历链接：https://cal.com/example",
  "将客户关于我们产品的反馈邮件打上 @[客户反馈] 标签",
  "将需要我们帮助和支持的客户邮件打上 @[客户支持] 标签",
  "将来自投资人的邮件打上 @[投资人] 标签",
  "将法律文件打上 @[法律] 标签",
  "将关于旅行的邮件打上 @[旅行] 标签",
  "将招聘相关的邮件打上 @[招聘] 标签",
];

export function getPersonas(provider: string) {
  return {
    founder: {
      label: "🚀 创始人",
      promptArray: processPromptsWithTerminology(founderPromptArray, provider),
      get prompt() {
        return formatPromptArray(this.promptArray);
      },
    },
    influencer: {
      label: "📹 网红",
      promptArray: processPromptsWithTerminology(
        [
          ...commonPrompts,
          `将赞助咨询打上 @[赞助] 标签并起草如下回复：
> 嗨 NAME，
>
> 我附上了我的媒体资料和报价`,
          "将关于联盟计划的邮件打上 @[联盟] 标签并归档",
          "将合作请求打上 @[合作] 标签并起草回复，询问他们的受众规模和互动率",
          "将品牌合作邮件打上 @[品牌合作] 标签并转发到 manager@example.com",
          "将媒体咨询打上 @[媒体] 标签并起草一条礼貌的回复",
        ],
        provider,
      ),
      get prompt() {
        return formatPromptArray(this.promptArray);
      },
    },
    realtor: {
      label: "🏠 房地产经纪人",
      promptArray: processPromptsWithTerminology(
        [
          ...commonPrompts,
          "将来自潜在买家的邮件打上 @[买家线索] 标签并起草回复，询问他们的预算和偏好的社区",
          "将来自潜在卖家的邮件打上 @[卖家线索] 标签并起草回复，附上我的日历链接以安排房屋评估：https://cal.com/example",
          "如果有人询问特定区域的房价，打上 @[市场咨询] 标签并起草回复，附上近期的可比销售数据",
          "将来自抵押贷款经纪人和贷款机构的邮件打上 @[贷款机构] 标签并归档",
          "如果有人要求安排看房，打上 @[看房请求] 标签并起草回复，附上可用的时间段",
          "将关于过户文件的邮件打上 @[过户] 标签并转发到 transactions@realty.com",
          "如果有人询问购房流程，起草回复并附上我们的买家指南链接：https://realty.com/buyers-guide",
          "将来自房屋检查员的邮件打上 @[检查员] 标签并转发到 scheduling@realty.com",
          "如果有人向我推荐客户，打上 @[推荐] 标签并起草一条感谢回复，附上我的日历链接以安排咨询",
        ],
        provider,
      ),
      get prompt() {
        return formatPromptArray(this.promptArray);
      },
    },
    investor: {
      label: "💰 投资人",
      promptArray: processPromptsWithTerminology(
        [
          ...commonPrompts,
          "如果创始人要求安排通话，起草回复并附上我的日历链接：https://cal.com/example",
          "如果创始人给我发送投资人更新，打上 @[投资人更新] 标签并归档",
          "将演示文稿转发到 analyst@vc.com，请他们审阅并打上 @[演示文稿] 标签",
          "将来自 LP 的邮件打上 @[LP] 标签",
          "将法律文件打上 @[法律] 标签",
          "将关于旅行的邮件打上 @[旅行] 标签",
          "将关于投资组合公司退出的邮件打上 @[退出机会] 标签",
          "将包含条款清单的邮件打上 @[条款清单] 标签",
          "如果投资组合公司报告坏消息，打上 @[投资组合警报] 标签并起草回复以安排紧急通话",
          "将尽职调查相关的邮件打上 @[尽职调查] 标签",
          "将关于行业研究报告的邮件转发到 research@vc.com",
          "如果有人请求引荐到某家投资组合公司，起草回复询问更多关于他们为何想联系的背景",
          "将关于基金管理行政的邮件打上 @[基金管理] 标签",
          "将关于在投资会议上演讲的邮件打上 @[演讲机会] 标签",
        ],
        provider,
      ),
      get prompt() {
        return formatPromptArray(this.promptArray);
      },
    },
    assistant: {
      label: "📋 助理",
      promptArray: processPromptsWithTerminology(founderPromptArray, provider),
      get prompt() {
        return formatPromptArray(this.promptArray);
      },
    },
    developer: {
      label: "👨‍💻 开发者",
      promptArray: processPromptsWithTerminology(
        [
          ...commonPrompts,
          "将服务器错误、部署失败和其他服务器警报打上 @[警报] 标签并转发到 oncall@company.com",
          "将来自 GitHub 的邮件打上 @[GitHub] 标签并归档",
          "将来自 Figma 的邮件打上 @[设计] 标签并归档",
          "将来自 Stripe 的邮件打上 @[Stripe] 标签并归档",
          "将来自 Slack 的邮件打上 @[Slack] 标签并归档",
          "将关于缺陷报告的邮件打上 @[缺陷] 标签",
          "如果有人报告安全漏洞，打上 @[安全] 标签并转发到 security@company.com",
          "将关于求职面试的邮件打上 @[求职] 标签",
          "将来自招聘人员的邮件打上 @[招聘人员] 标签并归档",
        ],
        provider,
      ),
      get prompt() {
        return formatPromptArray(this.promptArray);
      },
    },
    designer: {
      label: "🎨 设计师",
      promptArray: processPromptsWithTerminology(
        [
          ...commonPrompts,
          "将来自 Figma、Adobe、Sketch 和其他设计工具的邮件打上 @[设计] 标签并归档",
          "将来自客户的邮件打上 @[客户] 标签",
          "如果有人发送设计素材，打上 @[设计素材] 标签并转发到 assets@company.com",
          "将来自 Dribbble、Behance 和其他设计灵感网站的邮件打上 @[灵感] 标签并归档",
          "将关于设计会议的邮件打上 @[会议] 标签",
          "如果有人索取品牌素材，起草回复并附上我们品牌门户的链接：https://brand.company.com",
          "将关于用户研究的邮件打上 @[研究] 标签",
          "将关于求职面试的邮件打上 @[求职] 标签",
          "将来自招聘人员的邮件打上 @[招聘人员] 标签并归档",
        ],
        provider,
      ),
      get prompt() {
        return formatPromptArray(this.promptArray);
      },
    },
    sales: {
      label: "🤝 销售",
      promptArray: processPromptsWithTerminology(
        [
          ...commonPrompts,
          "将来自潜在客户的邮件打上 @[潜在客户] 标签",
          "将来自客户的邮件打上 @[客户] 标签",
          "将关于交易谈判的邮件打上 @[交易讨论] 标签",
          "将来自销售工具的邮件打上 @[销售工具] 标签并归档",
          "将关于销售机会的邮件打上 @[销售机会] 标签",
          "如果有人询问价格，起草回复并附上我们的定价页面链接：https://company.com/pricing",
          "将包含已签署合同的邮件打上 @[已签署合同] 标签并转发到 legal@company.com",
          "如果有人请求演示，起草回复并附上我的日历链接：https://cal.com/example",
          "如果有人询问产品功能，起草回复并附上相关功能文档链接",
          "如果有人报告实施问题，打上 @[支持需求] 标签并转发到 support@company.com",
          "如果有人询问企业版价格，起草回复询问其公司规模和需求",
          "如果客户提到流失风险，打上 @[流失风险] 标签并向客户成功团队起草一条紧急通知",
        ],
        provider,
      ),
      get prompt() {
        return formatPromptArray(this.promptArray);
      },
    },
    marketer: {
      label: "📢 营销人员",
      promptArray: processPromptsWithTerminology(
        [
          ...commonPrompts,
          "将来自网红的邮件打上 @[网红] 标签",
          "将来自广告平台（Google、Meta、LinkedIn）的邮件打上 @[广告] 标签",
          "将媒体咨询打上 @[媒体] 标签并转发到 pr@company.com",
          "将关于内容营销的邮件打上 @[内容] 标签",
          "如果有人询问赞助，打上 @[赞助] 标签并起草回复询问其受众规模",
          "如果有人请求投稿客座文章，打上 @[客座文章] 标签并起草回复附上我们的指南",
          "如果有人询问合作机会，打上 @[合作] 标签并起草回复索取他们的媒体资料",
          "如果有人报告营销链接失效，打上 @[缺陷] 标签并转发到 tech@company.com",
        ],
        provider,
      ),
      get prompt() {
        return formatPromptArray(this.promptArray);
      },
    },
    support: {
      label: "🛠️ 支持",
      promptArray: processPromptsWithTerminology(
        [
          ...commonPrompts,
          "将客户的求助请求打上 @[支持工单] 标签",
          "如果有人报告严重问题，打上 @[紧急支持] 标签并转发到 urgent@company.com",
          "将缺陷报告打上 @[缺陷] 标签并转发到 engineering@company.com",
          "将功能请求打上 @[功能请求] 标签并转发到 product@company.com",
          "如果有人要求退款，起草回复并附上我们的退款政策链接：https://company.com/refund-policy",
          "将关于账号访问问题的邮件打上 @[访问问题] 标签并起草回复索取他们的账号详情",
          "如果有人索取产品文档，起草回复并附上我们的帮助中心链接：https://help.company.com",
          "将关于服务中断的邮件打上 @[服务问题] 标签并转发到 status@company.com",
          "如果有人需要技术协助，起草回复索取他们的账号详情和具体错误信息",
          "将正面反馈打上 @[好评] 标签并转发到 marketing@company.com",
          "将关于 API 集成问题的邮件打上 @[API 支持] 标签",
          "如果有人报告数据隐私问题，打上 @[隐私] 标签，并起草回复附上我们的隐私政策链接：https://company.com/privacy-policy",
        ],
        provider,
      ),
      get prompt() {
        return formatPromptArray(this.promptArray);
      },
    },
    recruiter: {
      label: "👥 招聘人员",
      promptArray: processPromptsWithTerminology(
        [
          ...commonPrompts,
          "将来自候选人的邮件打上 @[候选人] 标签",
          "将来自招聘经理的邮件打上 @[招聘经理] 标签",
          "将来自招聘人员的邮件打上 @[招聘人员] 标签并起草回复附上我们的招聘流程概览链接：https://company.com/hiring-process",
          "将来自招聘网站的邮件打上 @[招聘网站] 标签并归档",
          "将来自 LinkedIn 的邮件打上 @[LinkedIn] 标签并归档",
          "如果有人申请职位，打上 @[新申请] 标签并起草回复确认收到他们的申请",
          "将包含简历或 CV 的邮件打上 @[简历] 标签",
          "如果候选人询问申请状态，打上 @[状态更新] 标签并起草回复询问其应聘职位和申请日期",
          "将关于面试安排的邮件打上 @[面试安排] 标签",
          "如果有人接受面试邀请，打上 @[面试已确认] 标签并转发到 calendar@company.com",
          "如果有人拒绝录用通知，打上 @[已拒绝录用] 标签并转发到 hiring-updates@company.com",
          "如果有人接受录用通知，打上 @[已接受录用] 标签并转发到 onboarding@company.com",
          "将关于薪资谈判的邮件打上 @[薪酬] 标签",
          "将关于背景调查的邮件打上 @[背景调查] 标签",
          "如果有人询问福利，起草回复并附上我们的福利概览链接：https://company.com/benefits",
          "将关于背景审查的邮件打上 @[背景审查] 标签",
          "如果内部员工推荐他人，打上 @[员工推荐] 标签",
          "将关于招聘活动或招聘会的邮件打上 @[招聘活动] 标签",
          "如果有人撤回申请，打上 @[已撤回] 标签",
        ],
        provider,
      ),
      get prompt() {
        return formatPromptArray(this.promptArray);
      },
    },
    student: {
      label: "👩‍🎓 学生",
      promptArray: processPromptsWithTerminology(
        [
          "将来自教授和助教的邮件打上 @[学校] 标签",
          "将关于作业和功课的邮件打上 @[作业] 标签",
          "如果有人发送课堂笔记或学习材料，打上 @[学习材料] 标签",
          "将关于实习的邮件打上 @[实习] 标签并转发到我的个人邮箱 me@example.com",
          "将关于考试安排的邮件打上 @[考试] 标签",
          "将关于校园活动的邮件打上 @[活动] 标签并归档",
          "如果有人索取课堂笔记，起草回复并附上我们共享的 Google Drive 文件夹链接：https://drive.google.com/drive/u/0/folders/1234567890",
          "将关于家教机会的邮件打上 @[家教] 标签并起草回复，说明我的费率是 $70/小时，小组辅导为 $40/小时",
        ],
        provider,
      ),
      get prompt() {
        return formatPromptArray(this.promptArray);
      },
    },
    reachout: {
      label: "💬 外联",
      promptArray: processPromptsWithTerminology(
        [
          "如果有人回复我表示感兴趣，打上 @[感兴趣] 标签并起草回复附上我的日历链接：https://cal.com/example",
        ],
        provider,
      ),
      get prompt() {
        return formatPromptArray(this.promptArray);
      },
    },
    other: {
      label: "🤖 其他",
      promptArray: getExamplePrompts(provider),
      get prompt() {
        return formatPromptArray(this.promptArray);
      },
    },
  };
}
