import { Button } from "@/components/ui/button";
import { MessageText, TypographyH3 } from "@/components/Typography";
import { ExamplesDialog } from "./examples-dialog";
import { MessageCircleIcon } from "lucide-react";

export const Overview = ({
  setInput,
}: {
  setInput: (input: string) => void;
}) => (
  <div className="mx-auto flex h-full max-w-3xl items-center justify-center">
    <div className="flex max-w-xl flex-col rounded-xl p-6 text-center leading-relaxed">
      <p className="flex flex-row items-center justify-center gap-4">
        <MessageCircleIcon size={32} />
      </p>

      <TypographyH3 className="mt-8">你好，我是你的邮件助手！</TypographyH3>

      <MessageText className="mt-4 text-base">
        教我如何处理你的收件邮件
      </MessageText>

      <div className="pt-8">
        <ExamplesDialog setInput={setInput}>
          <Button>从示例中选择</Button>
        </ExamplesDialog>
      </div>
    </div>
  </div>
);
