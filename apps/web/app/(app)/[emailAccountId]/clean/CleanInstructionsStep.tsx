"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryState, parseAsString } from "nuqs";
import { type SubmitHandler, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { TypographyH3 } from "@/components/Typography";
import { Input } from "@/components/Input";
import { useStep } from "@/app/(app)/[emailAccountId]/clean/useStep";
import { Toggle } from "@/components/Toggle";
import { useSkipSettings } from "@/app/(app)/[emailAccountId]/clean/useSkipSettings";

const schema = z.object({ instructions: z.string().optional() });

type Inputs = z.infer<typeof schema>;

export function CleanInstructionsStep() {
  const { onNext } = useStep();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Inputs>({
    resolver: zodResolver(schema),
  });
  const [_, setInstructions] = useQueryState("instructions", parseAsString);
  const [showCustom, setShowCustom] = useState(false);
  const [skipStates, setSkipStates] = useSkipSettings();

  const onSubmit: SubmitHandler<Inputs> = (data) => {
    if (showCustom) {
      setInstructions(data.instructions || "");
    }
    onNext();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="text-center">
      <TypographyH3>哪些邮件应留在收件箱中？</TypographyH3>

      <div className="mt-4 grid gap-4">
        <Toggle
          name="reply"
          enabled={skipStates.skipReply}
          onChange={(value) => setSkipStates({ skipReply: value })}
          labelRight="需要回复的邮件"
        />
        <Toggle
          name="starred"
          enabled={skipStates.skipStarred}
          onChange={(value) => setSkipStates({ skipStarred: value })}
          labelRight="已加星标的邮件"
        />
        <Toggle
          name="calendar"
          enabled={skipStates.skipCalendar}
          onChange={(value) => setSkipStates({ skipCalendar: value })}
          labelRight="未来的事件"
        />
        <Toggle
          name="receipt"
          enabled={skipStates.skipReceipt}
          onChange={(value) => setSkipStates({ skipReceipt: value })}
          labelRight="付款收据"
        />
        {/* <Toggle
          name="attachment"
          enabled={skipStates.skipAttachment}
          onChange={(value) => setSkipStates({ skipAttachment: value })}
          labelRight="带附件的邮件"
        /> */}
        <Toggle
          name="conversation"
          enabled={skipStates.skipConversation}
          onChange={(value) => setSkipStates({ skipConversation: value })}
          labelRight="会话"
          tooltipText="你发送过回复的邮件会话"
        />
        <Toggle
          name="custom"
          enabled={showCustom}
          onChange={(value) => setShowCustom(value)}
          labelRight="自定义"
        />
      </div>

      {showCustom && (
        <div className="mt-4">
          <Input
            type="text"
            autosizeTextarea
            rows={3}
            name="instructions"
            registerProps={register("instructions")}
            placeholder={`示例：

我是一名自由职业设计师。不要归档客户的邮件。
我正在做一个建筑项目，这些邮件也请保留。`}
            error={errors.instructions}
          />
        </div>
      )}

      <div className="mt-6 flex justify-center">
        <Button type="submit">继续</Button>
      </div>
    </form>
  );
}
