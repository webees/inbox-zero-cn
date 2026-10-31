import { Button } from "@/components/Button";
import { PageHeading, TypographyP } from "@/components/Typography";
import { BasicLayout } from "@/components/layouts/BasicLayout";
import { CardBasic } from "@/components/ui/card";

// 与 not-found 使用相同的组件
export default function ThankYouPage() {
  return (
    <BasicLayout>
      <div className="pb-40 pt-60">
        <CardBasic className="mx-auto max-w-xl text-center">
          <PageHeading>谢谢！</PageHeading>
          <div className="mt-2">
            <TypographyP>你的高级版购买已成功。感谢你的支持！</TypographyP>
          </div>
          <Button className="mt-4" size="xl" link={{ href: "/setup" }}>
            继续
          </Button>
        </CardBasic>
      </div>
    </BasicLayout>
  );
}
