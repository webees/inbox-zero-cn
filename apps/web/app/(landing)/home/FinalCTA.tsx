import { CallToAction } from "@/components/new-landing/CallToAction";
import { PatternBanner } from "@/components/new-landing/PatternBanner";
import { BRAND_NAME } from "@/utils/branding";

export function FinalCTA() {
  return (
    <PatternBanner
      title={
        <>
          每天省下一小时。
          <br />
          {`开始使用 ${BRAND_NAME}。`}
        </>
      }
      subtitle="少花时间在收件箱，多花时间在真正重要的事情上。"
    >
      <CallToAction text="免费开始使用" buttonSize="lg" className="mt-6" />
    </PatternBanner>
  );
}
