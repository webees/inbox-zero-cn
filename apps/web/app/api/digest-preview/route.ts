import type { NextRequest } from "next/server";
import { render } from "@react-email/render";
import DigestEmail, {
  type DigestEmailProps,
} from "@inboxzero/transactional-email/emails/digest";
import { digestPreviewBody } from "@/app/api/digest-preview/validation";

// http://localhost:3000/api/digest-preview?categories=["Newsletter","Receipt","Marketing","Cold Emails"]
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const categoriesParam = searchParams.get("categories");

    let categories: string[];
    try {
      categories = categoriesParam
        ? JSON.parse(decodeURIComponent(categoriesParam))
        : [];
    } catch {
      return new Response("Invalid categories parameter", { status: 400 });
    }

    const { success, data } = digestPreviewBody.safeParse({
      categories,
    });

    if (!success)
      return new Response("Invalid categories parameter", { status: 400 });

    const digestData = createMockDigestData(data.categories);

    const html = await render(DigestEmail(digestData));

    return new Response(html, {
      headers: {
        "Content-Type": "text/html",
      },
    });
  } catch {
    return new Response("Error rendering preview", { status: 500 });
  }
}

function createMockDigestData(categories: string[]): DigestEmailProps {
  const digestData: DigestEmailProps = {
    baseUrl: "https://www.getinboxzero.com",
    unsubscribeToken: "preview-token",
    emailAccountId: "preview-account",
    date: new Date(),
  };

  const mockDataTemplates = {
    newsletter: [
      {
        from: "Morning Brew",
        subject: "🔥 今日热门商业资讯",
        content: "Apple 发布 Vision Pro 2，设计减重 40%，售价 2,499 美元",
      },
      {
        from: "The New York Times",
        subject: "突发新闻：最新进展",
        content: "美联储释放可能降息的信号，通胀显现降温迹象，降至 3.2%",
      },
    ],
    receipt: [
      {
        from: "Amazon",
        subject: "Order #123-4567890-1234567",
        content: "你的订单已送达门口。",
      },
      {
        from: "Uber Eats",
        subject: "你的餐点正在派送中！",
        content: "预计送达时间：15-20 分钟",
      },
    ],
    marketing: [
      {
        from: "Spotify",
        subject: "限时优惠：3 个月高级版仅需 0.99 美元",
        content: "用这项专属优惠升级你的音乐体验",
      },
      {
        from: "Nike",
        subject: "最新上架：全新夏季系列 🔥",
        content: "抢先选购我们的最新款式，售完即止",
      },
    ],
    calendar: [
      {
        from: "Sarah Johnson",
        subject: "团队每周同步会",
        content:
          "标题：团队每周同步会\n日期：明天 10:00 AM - 11:00 AM • 3 号会议室 / Zoom",
      },
    ],
    notification: [
      {
        from: "LinkedIn",
        subject: "来自 Sarah M. 的新联系人请求",
        content: "Sarah M. 想在 LinkedIn 上与你建立联系。",
      },
    ],
    toReply: [
      {
        from: "John Smith",
        subject: "Re: 项目提案反馈",
        content: "收到时间：昨天 4:30 PM • 截止：今天",
      },
    ],
    coldEmail: [
      {
        from: "David Williams",
        subject: "为你的业务带来合作机会",
        content: "成长方案公司",
      },
      {
        from: "Jennifer Lee",
        subject: "想约本周做一次简短通话",
        content: "风险投资伙伴公司",
      },
    ],
  };

  for (const category of categories) {
    // Handle special case for Cold Emails
    if (category === "Cold Emails") {
      digestData.coldEmail = mockDataTemplates.coldEmail;
    } else {
      // Try to map rule name to a mock data category
      const mappedCategory = mapRuleNameToCategory(category);

      if (mockDataTemplates[mappedCategory as keyof typeof mockDataTemplates]) {
        digestData[mappedCategory] =
          mockDataTemplates[mappedCategory as keyof typeof mockDataTemplates];
      } else {
        // For custom rules, show generic rule-matched content
        digestData[category] = [
          {
            from: "Example Sender",
            subject: `Email matched by "${category}" rule`,
            content:
              "This is an example of content that would be captured by this rule.",
          },
          {
            from: "Another Sender",
            subject: `Another email for "${category}"`,
            content:
              "This shows what a second email matching this rule might look like.",
          },
        ];
      }
    }
  }

  return digestData;
}

function mapRuleNameToCategory(ruleName: string): string {
  const lowerName = ruleName.toLowerCase();

  // Direct matches for common rule names
  if (lowerName === "newsletter" || lowerName === "newsletters")
    return "newsletter";
  if (lowerName === "receipt" || lowerName === "receipts") return "receipt";
  if (lowerName === "marketing") return "marketing";
  if (lowerName === "calendar" || lowerName === "meetings") return "calendar";
  if (lowerName === "notification" || lowerName === "notifications")
    return "notification";
  if (lowerName === "to reply" || lowerName === "toreply") return "toReply";

  // Partial matches for rule names containing keywords
  if (lowerName.includes("newsletter") || lowerName.includes("news"))
    return "newsletter";
  if (
    lowerName.includes("receipt") ||
    lowerName.includes("order") ||
    lowerName.includes("purchase")
  )
    return "receipt";
  if (
    lowerName.includes("marketing") ||
    lowerName.includes("promo") ||
    lowerName.includes("deal")
  )
    return "marketing";
  if (
    lowerName.includes("calendar") ||
    lowerName.includes("meeting") ||
    lowerName.includes("event")
  )
    return "calendar";
  if (lowerName.includes("notification") || lowerName.includes("alert"))
    return "notification";
  if (lowerName.includes("reply") || lowerName.includes("response"))
    return "toReply";

  // Return the original name if no mapping found (will trigger custom rule display)

  return ruleName;
}
