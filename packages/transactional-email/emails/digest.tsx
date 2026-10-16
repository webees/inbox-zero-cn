import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";

type DigestItem = {
  from: string;
  subject: string;
  content: string;
};

const colorClasses = {
  blue: {
    bg: "bg-blue-50",
    text: "text-blue-800",
    leftBorder: "border-l-blue-400",
    bgAccent: "bg-blue-100",
  },
  green: {
    bg: "bg-green-50",
    text: "text-green-800",
    leftBorder: "border-l-green-400",
    bgAccent: "bg-green-100",
  },
  purple: {
    bg: "bg-purple-50",
    text: "text-purple-800",
    leftBorder: "border-l-purple-400",
    bgAccent: "bg-purple-100",
  },
  amber: {
    bg: "bg-amber-50",
    text: "text-amber-800",
    leftBorder: "border-l-amber-400",
    bgAccent: "bg-amber-100",
  },
  gray: {
    bg: "bg-gray-50",
    text: "text-gray-800",
    leftBorder: "border-l-gray-400",
    bgAccent: "bg-gray-100",
  },
  pink: {
    bg: "bg-pink-50",
    text: "text-pink-800",
    leftBorder: "border-l-pink-400",
    bgAccent: "bg-pink-100",
  },
  red: {
    bg: "bg-red-50",
    text: "text-red-800",
    leftBorder: "border-l-red-400",
    bgAccent: "bg-red-100",
  },
} as const;

type NormalizedCategoryData = {
  count: number;
  senders: string[];
  items: DigestItem[];
};

export type DigestEmailProps = {
  baseUrl: string;
  unsubscribeToken: string;
  date?: Date;
  ruleNames?: Record<string, string>;
  emailAccountId: string;
  [key: string]:
    | NormalizedCategoryData
    | DigestItem[]
    | undefined
    | string
    | Date
    | Record<string, string>
    | undefined;
};
export default function DigestEmail(props: DigestEmailProps) {
  const {
    baseUrl = "https://www.getinboxzero.com",
    unsubscribeToken,
    ruleNames,
    emailAccountId,
    ...digestData
  } = props;

  const categoryColors: Record<string, keyof typeof colorClasses> = {
    newsletter: "blue",
    receipt: "green",
    marketing: "purple",
    calendar: "amber",
    coldEmail: "gray",
    notification: "pink",
    toReply: "red",
  };

  // Check if there are any items to display
  const hasItems = Object.keys(digestData).some((key) => {
    const categoryData = normalizeCategoryData(key, digestData[key]);
    return categoryData && categoryData.count > 0;
  });

  const renderEmailContent = (item: DigestItem) => {
    if (!item.content) return null;

    const contentText = item.content;

    // Split content by newlines and render each line separately
    const lines = contentText.split("\n").filter((line: string) => line.trim());

    // If there are multiple lines, render as bullet points
    if (lines.length > 1) {
      return (
        <div>
          <ul className="m-0 pl-[20px]">
            {lines.map((line: string, index: number) => {
              // Remove leading bullet point characters (•, -, *, etc.) if present
              const cleanedLine = line.trim().replace(/^[•\-*]\s+/, "");
              return (
                <li key={index} className="text-[14px] text-gray-800 mb-[1px]">
                  {cleanedLine}
                </li>
              );
            })}
          </ul>
        </div>
      );
    } else {
      // 单行内容
      return (
        <Text className="text-[14px] text-gray-800 mt-[4px] mb-0 leading-[1.5]">
          {contentText}
        </Text>
      );
    }
  };

  const CategorySection = ({
    categoryKey,
    categoryData,
  }: {
    categoryKey: string;
    categoryData: NormalizedCategoryData;
  }) => {
    const colors = colorClasses[categoryColors[categoryKey] || "gray"];

    if (categoryData.items.length > 0) {
      return (
        <Section className="mb-[8px]" id={categoryKey}>
          <div className="mb-[8px]">
            <div className="text-left mb-[8px]">
              <div className="px-4 py-3">
                <Text className="text-[16px] text-gray-700 mt-0 mb-0">
                  {categoryData.count}{" "}
                  <span className={`${colors.text} font-semibold`}>
                    {ruleNames?.[categoryKey] || categoryKey}
                  </span>
                  {" 来自 "}
                  {categoryData.senders.map((sender, index) => {
                    if (index === 0) {
                      return sender;
                    } else {
                      return `, ${sender}`;
                    }
                  })}
                  {categoryData.count > 5 && " 以及更多"}
                </Text>
              </div>
            </div>

            <div
              className={`border-l-[4px] border-t border-r border-b border-solid border-gray-200 ${colors.leftBorder} bg-[#fdfefe] rounded-[8px] overflow-hidden`}
            >
              {categoryData.items.map((item, index) => (
                <div key={index}>
                  <div className="p-[20px]">
                    {/* 邮件标头 */}
                    <div className="mb-[12px]">
                      <Text className="text-[16px] font-bold text-gray-900 mt-0 mb-0">
                        {item.subject}
                      </Text>
                      <Text className="text-[14px] text-gray-700 mt-[2px] mb-0">
                        发件人：{" "}
                        <span className="font-medium text-gray-800">
                          {item.from}
                        </span>
                      </Text>
                    </div>

                    {/* 邮件内容 */}
                    {renderEmailContent(item)}
                  </div>

                  {/* 分隔线 - 最后一项之后不显示 */}
                  {index < categoryData.items.length - 1 && (
                    <Hr className="border-solid border-gray-200 my-0 mx-[20px]" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </Section>
      );
    } else {
      // 没有高亮内容的分类 - 更紧凑
      return (
        <div className="mb-[4px]" id={categoryKey}>
          <div className="px-4 py-2">
            <Text className="text-[16px] text-gray-700 mt-0 mb-0">
              {categoryData.count}{" "}
              <span className={`${colors.text} font-semibold`}>
                {ruleNames?.[categoryKey] || categoryKey}
              </span>
              {" 来自 "}
              {categoryData.senders.map((sender, index) => {
                if (index === 0) {
                  return sender;
                } else {
                  return `, ${sender}`;
                }
              })}
              {categoryData.count > 5 && " 以及更多"}
            </Text>
          </div>
        </div>
      );
    }
  };

  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className="bg-white font-sans">
          <Container className="mx-auto w-full max-w-[600px] p-0">
            <Section className="p-4 text-center">
              <Link href={baseUrl} className="text-[15px]">
                <Img
                  src={"https://www.getinboxzero.com/icon.png"}
                  width="40"
                  height="40"
                  alt="Inbox Zero"
                  className="mx-auto my-0"
                />
              </Link>

              <Text className="mx-0 mb-8 mt-4 p-0 text-center text-2xl font-normal">
                <span className="font-semibold tracking-tighter">
                  Inbox Zero
                </span>
              </Text>

              <Heading className="my-4 text-4xl font-medium leading-tight">
                你的邮件摘要
              </Heading>
              <Text className="mb-8 text-lg leading-8">
                以下是你的收件箱中发生的事情摘要。
              </Text>
            </Section>

            {hasItems ? (
              Object.keys(digestData).map((categoryKey) => {
                const categoryData = normalizeCategoryData(
                  categoryKey,
                  digestData[categoryKey],
                );
                if (!categoryData) return null;

                return (
                  <CategorySection
                    key={categoryKey}
                    categoryKey={categoryKey}
                    categoryData={categoryData}
                  />
                );
              })
            ) : (
              <Section className="mb-8 text-center">
                <Text className="text-gray-500 text-lg">
                  此邮件摘要中没有可汇总的邮件。
                </Text>
                <Text className="text-gray-400 text-sm mt-2">
                  有需要汇报的邮件时，我们会给你发送摘要。
                </Text>
              </Section>
            )}
            <Hr className="border-solid border-gray-200 my-[24px]" />
            <Footer
              baseUrl={baseUrl}
              unsubscribeToken={unsubscribeToken}
              emailAccountId={emailAccountId}
            />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

DigestEmail.PreviewProps = {
  baseUrl: "https://www.getinboxzero.com",
  unsubscribeToken: "123",
  emailAccountId: "123",
  ruleNames: {
    newsletter: "Newsletter",
    receipt: "Receipt",
    marketing: "Marketing",
    calendar: "Calendar",
    coldEmail: "Cold Email",
    notification: "Notification",
    toReply: "To Reply",
    travel: "Travel",
    funnyStuff: "Funny Stuff",
    orders: "Orders",
  },
  newsletter: [
    {
      from: "Morning Brew",
      subject: "🔥 Today's top business stories",
      content:
        "Apple unveils Vision Pro 2 with 40% lighter design and $2,499 price tag",
    },
    {
      from: "纽约时报",
      subject: "Breaking News: Latest developments",
      content:
        "Fed signals potential rate cuts as inflation shows signs of cooling to 3.2%",
    },
    {
      from: "Product Hunt 日报",
      subject: "🚀 Today's hottest tech products",
      content:
        "Claude Projects: Anthropic's new workspace for organizing AI conversations (847 upvotes)",
    },
    {
      from: "TechCrunch",
      subject: "Startup funding roundup: Q1 2024",
      content: "AI startups raised $12B in Q1, up 45% from last year",
    },
    {
      from: "The Verge",
      subject: "CES 2024: The best gadgets and announcements",
      content: "Samsung unveils transparent MicroLED displays",
    },
    {
      from: "Ars Technica",
      subject: "SpaceX Starship achieves orbital milestone",
      content: "Successful launch and landing of Starship prototype",
    },
    {
      from: "Wired",
      subject: "The future of quantum computing",
      content: "IBM reaches 1,000+ qubit milestone",
    },
    {
      from: "MIT Technology Review",
      subject: "Climate tech innovations to watch",
      content: "Direct air capture technology breakthrough",
    },
  ],
  receipt: [
    {
      from: "Amazon",
      subject: "Order #123-4567890-1234567",
      content: "Your order has been delivered to your doorstep.",
    },
    {
      from: "Uber Eats",
      subject: "Your food is on the way!",
      content: "Estimated delivery: 15-20 minutes",
    },
    {
      from: "Netflix",
      subject: "Payment received for Netflix subscription",
      content: "Amount: $15.99\nNext billing date: March 15, 2024",
    },
    {
      from: "Spotify",
      subject: "Premium subscription renewed",
      content:
        "Your Spotify Premium subscription has been renewed for $9.99/month.",
    },
    {
      from: "Apple",
      subject: "iCloud storage payment",
      content: "iCloud+ 50GB plan renewed for $0.99/month.",
    },
    {
      from: "Starbucks",
      subject: "Receipt for your purchase",
      content: "Location: Downtown Store, Total: $18.75",
    },
    {
      from: "Target",
      subject: "Order confirmation #TGT-789456",
      content:
        "Order total: $67.89\nItems: 5 items\nEstimated delivery: Tomorrow\nTracking: UPS 1Z999AA1234567890",
    },
    {
      from: "DoorDash",
      subject: "Your delivery is complete",
      content:
        "Restaurant: Thai Palace\nOrder: Pad Thai, Spring Rolls, Thai Iced Tea\nTotal: $32.45\nTip: $5.00",
    },
    {
      from: "Walmart",
      subject: "Online order shipped",
      content:
        "Order #WM-456789\nItems: 3 items\nTotal: $89.99\nCarrier: FedEx\nTracking: 123456789012",
    },
    {
      from: "Costco",
      subject: "Monthly membership renewal",
      content:
        "Executive Membership renewed\nAnnual fee: $120.00\nNext renewal: March 15, 2025\nBenefits: 2% cashback, travel discounts",
    },
  ],
  marketing: [
    {
      from: "Spotify",
      subject: "Limited offer: 3 months premium for $0.99",
      content: "Upgrade your music experience with this exclusive deal",
    },
    {
      from: "Nike",
      subject: "JUST IN: New Summer Collection 🔥",
      content: "Be the first to shop our latest styles before they sell out",
    },
    {
      from: "Airbnb",
      subject: "Weekend getaway ideas near you",
      content: "Discover unique stays within a 2-hour drive from your location",
    },
  ],
  calendar: [
    {
      from: "Sarah Johnson",
      subject: "团队每周例会",
      content:
        "标题：团队每周同步\n日期：明天 10:00 - 11:00 • 3 号会议室 / Zoom",
    },
    {
      from: "Michael Chen",
      subject: "季度评审",
      content:
        "标题：季度评审\n日期：5 月 26 日星期五 14:00 - 16:00 • A 会议室",
    },
    {
      from: "个人日历",
      subject: "牙医预约",
      content: "标题：牙医预约\n日期：5 月 29 日星期一 9:30 • 市中心牙科诊所",
    },
  ],
  coldEmail: [
    {
      from: "David Williams",
      subject: "为你的业务提供的合作机会",
      content: "增长解决方案公司",
    },
    {
      from: "Jennifer Lee",
      subject: "希望本周快速通话",
      content: "风险投资伙伴公司",
    },
    {
      from: "Robert Taylor",
      subject: "介绍我们的新 B2B 解决方案",
      content: "企业科技解决方案公司",
    },
  ],
  notification: [
    {
      from: "LinkedIn",
      subject: "来自 Sarah M. 的新连接请求",
      content: "Sarah M. 想在 LinkedIn 上与你建立联系。",
    },
    {
      from: "Slack",
      subject: "#general 中的新消息",
      content: "Alex：有人能帮我处理部署吗？",
    },
    {
      from: "GitHub",
      subject: "拉取请求 #1234 需要你审阅",
      content: "仓库：myapp\n分支：feature/new-feature\n更改的文件：15",
    },
    {
      from: "Twitter",
      subject: "新粉丝：@techguru",
      content: "你在 Twitter 上有一个新粉丝。",
    },
    {
      from: "Discord",
      subject: "#development 中的新消息",
      content: "Mike：新的 API 端点运行得很好！",
    },
  ],
  toReply: [
    {
      from: "John Smith",
      subject: "Re: Project proposal feedback",
      content: "Received: Yesterday, 4:30 PM • Due: Today",
    },
    {
      from: "Client XYZ",
      subject: "Questions about the latest deliverable",
      content: "Received: Monday, 10:15 AM • Due: Tomorrow",
    },
    {
      from: "HR Department",
      subject: "Annual review scheduling",
      content: "Received: Tuesday, 9:00 AM • Due: Friday",
    },
  ],
  // --- Custom categories for testing ---
  travel: [
    {
      from: "Expedia",
      subject: "Your flight to Paris is booked!",
      content: "Flight departs July 10th at 7:00 PM. Confirmation #ABC123.",
    },
    {
      from: "Airbnb",
      subject: "Upcoming stay in Montmartre",
      content: "Check-in: July 11th, Check-out: July 18th. Host: Marie.",
    },
  ],
  funnyStuff: [
    {
      from: "The Onion",
      subject: "男子不确定自己活在模拟世界还是密尔沃基",
      content:
        "Local man questions reality after seeing three people in cheese hats.",
    },
    {
      from: "Reddit",
      subject: "Top meme of the day",
      content: "A cat wearing sunglasses and riding a Roomba.",
    },
  ],
  orders: [
    {
      from: "Shopify",
      subject: "Order #SHOP-2024-001",
      content:
        "Order ID: SHOP-2024-001\nTotal: $89.99\nStatus: Shipped\nTracking: 1Z999AA1234567890",
    },
    {
      from: "Etsy",
      subject: "Your handmade jewelry order",
      content:
        "Seller: HandmadeCrafts\nItem: Sterling Silver Necklace\nPrice: $45.00\nEstimated Delivery: March 15-20",
    },
    {
      from: "Amazon",
      subject: "订单 #114-1234567-8901234",
      content:
        "订单号：114-1234567-8901234\n商品：3 件\n总计：$156.78\n配送：明天 20:00 前",
    },
  ],
};

function Footer({
  baseUrl,
  unsubscribeToken,
  emailAccountId,
}: {
  baseUrl: string;
  unsubscribeToken: string;
  emailAccountId: string;
}) {
  return (
    <Section className="mt-8 text-center text-sm text-gray-500">
      <Text className="m-0">
        你收到此邮件是因为你在 Inbox Zero 设置中启用了邮件摘要。
      </Text>
      <div className="mt-[8px]">
        <Link
          href={`${baseUrl}/api/unsubscribe?token=${unsubscribeToken}`}
          className="text-gray-500 underline mr-[16px]"
        >
          取消订阅
        </Link>
        <Link
          href={`${baseUrl}/${emailAccountId}/automation?tab=settings`}
          className="text-gray-500 underline"
        >
          自定义你接收的内容
        </Link>
      </div>
    </Section>
  );
}

export const generateDigestSubject = (props: DigestEmailProps): string => {
  const { ruleNames, ...digestData } = props;

  const categoriesWithCounts: Array<{ name: string; count: number }> = [];

  Object.keys(digestData).forEach((key) => {
    const categoryData = normalizeCategoryData(key, digestData[key]);
    if (categoryData && categoryData.count > 0) {
      const displayName = ruleNames?.[key] || key;
      categoriesWithCounts.push({
        name: displayName,
        count: categoryData.count,
      });
    }
  });

  const topCategories = categoriesWithCounts
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  if (topCategories.length === 0) {
    return "你的邮件摘要";
  }

  if (topCategories.length === 1) {
    const { name, count } = topCategories[0];
    return `${count} 封${name}邮件摘要`;
  }

  if (topCategories.length === 2) {
    const [first, second] = topCategories;
    return `${first.count} 封${first.name}邮件和 ${second.count} 封${second.name}邮件摘要`;
  }

  const [first, second, third] = topCategories;
  return `${first.count} 封${first.name}邮件、${second.count} 封${second.name}邮件和 ${third.count} 封${third.name}邮件摘要`;
};

const normalizeCategoryData = (
  _key: string,
  data:
    | DigestItem[]
    | NormalizedCategoryData
    | string
    | Date
    | Record<string, string>
    | undefined,
): NormalizedCategoryData | null => {
  if (Array.isArray(data)) {
    const items = data;
    const senders = Array.from(new Set(items.map((item) => item.from))).slice(
      0,
      5,
    );
    return {
      count: items.length,
      senders,
      items,
    };
  } else if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    "count" in data &&
    "senders" in data &&
    "items" in data &&
    typeof data.count === "number" &&
    Array.isArray(data.senders) &&
    Array.isArray(data.items)
  ) {
    return data as NormalizedCategoryData;
  }
  return null;
};
