import { Rule } from "@/app/(app)/[emailAccountId]/assistant/RuleForm";
import { TopSection } from "@/components/TopSection";

export default async function RulePage(props: {
  params: Promise<{ ruleId: string; account: string }>;
  searchParams: Promise<{ new: string }>;
}) {
  const [params, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);

  return (
    <div>
      {searchParams.new === "true" && (
        <TopSection
          title="这是你的规则设置！"
          descriptionComponent={<p>这些规则由 AI 生成，请根据需要随时调整。</p>}
        />
      )}
      <div className="content-container mx-auto w-full max-w-3xl">
        <Rule ruleId={params.ruleId} />
      </div>
    </div>
  );
}
