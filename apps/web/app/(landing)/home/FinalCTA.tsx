import { Trans, useLingui } from "@lingui/react/macro";
import { CallToAction } from "@/components/new-landing/CallToAction";
import { PatternBanner } from "@/components/new-landing/PatternBanner";
import { BRAND_NAME } from "@/utils/branding";

export function FinalCTA() {
  const { t } = useLingui();

  return (
    <PatternBanner
      title={
        <Trans>
          每天找回一小时。
          <br />
          开始使用 {BRAND_NAME}。
        </Trans>
      }
      subtitle={t`减少收件箱时间，把更多时间留给真正重要的事。`}
    >
      <CallToAction text={t`免费开始使用`} buttonSize="lg" className="mt-6" />
    </PatternBanner>
  );
}
