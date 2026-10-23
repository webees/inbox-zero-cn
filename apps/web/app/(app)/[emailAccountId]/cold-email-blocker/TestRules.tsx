// 这是 assistant/TestRules.tsx 文件的复制粘贴
// 大概可以从中提取一些通用组件

"use client";

import { useCallback, useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import useSWR from "swr";
import { SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/Input";
import { toastError } from "@/components/Toast";
import { LoadingContent } from "@/components/LoadingContent";
import type { MessagesResponse } from "@/app/api/messages/route";
import { Separator } from "@/components/ui/separator";
import { AlertBasic } from "@/components/Alert";
import { EmailMessageCell } from "@/components/EmailMessageCell";
import { SearchForm } from "@/components/SearchForm";
import { TableCell, TableRow, Table, TableBody } from "@/components/ui/table";
import { CardContent } from "@/components/ui/card";
import { testColdEmailAction } from "@/utils/actions/cold-email";
import type { ColdEmailBlockerBody } from "@/utils/actions/cold-email.validation";
import { useAccount } from "@/providers/EmailAccountProvider";

type ColdEmailBlockerResponse = {
  isColdEmail: boolean;
  aiReason?: string | null;
  reason?: string | null;
};

export function TestRulesContent() {
  const [searchQuery, setSearchQuery] = useState("");
  const { data, isLoading, error } = useSWR<MessagesResponse>(
    `/api/messages?q=${searchQuery}`,
    {
      keepPreviousData: true,
      dedupingInterval: 1000,
    },
  );

  const { userEmail } = useAccount();

  return (
    <div>
      <CardContent>
        <TestRulesForm />

        <div className="mt-4 max-w-sm">
          <SearchForm
            defaultQuery={searchQuery || undefined}
            onSearch={setSearchQuery}
          />
        </div>
      </CardContent>

      <Separator />

      <LoadingContent loading={isLoading} error={error}>
        {data && (
          <Table>
            <TableBody>
              {data.messages.map((message) => (
                <TestRulesContentRow
                  key={message.id}
                  message={message}
                  userEmail={userEmail}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </LoadingContent>
    </div>
  );
}

type TestRulesInputs = { message: string };

const TestRulesForm = () => {
  const { response, testEmail } = useColdEmailTest();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TestRulesInputs>({
    defaultValues: {
      message: "嗨，我经营一家开发公司。想问问你的团队是否需要人手？",
    },
  });

  const onSubmit: SubmitHandler<TestRulesInputs> = useCallback(
    async (data) => {
      await testEmail({
        from: "",
        subject: "",
        textHtml: null,
        textPlain: data.message,
        snippet: null,
        threadId: null,
        messageId: null,
        date: undefined,
      });
    },
    [testEmail],
  );

  return (
    <div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          type="text"
          autosizeTextarea
          rows={3}
          name="message"
          label="用于测试的邮件"
          placeholder="嗨，我经营一家营销公司，很想聊聊。"
          registerProps={register("message", { required: true })}
          error={errors.message}
        />
        <Button type="submit" loading={isSubmitting}>
          <SparklesIcon className="mr-2 h-4 w-4" />
          测试
        </Button>
      </form>
      {response && (
        <div className="mt-4">
          <Result coldEmailResponse={response} />
        </div>
      )}
    </div>
  );
};

function TestRulesContentRow({
  message,
  userEmail,
}: {
  message: MessagesResponse["messages"][number];
  userEmail: string;
}) {
  const { testing, response, testEmail } = useColdEmailTest();

  return (
    <TableRow
      className={
        testing ? "animate-pulse bg-blue-50 dark:bg-blue-950/20" : undefined
      }
    >
      <TableCell>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <EmailMessageCell
              sender={message.headers.from}
              subject={message.headers.subject}
              snippet={message.snippet}
              userEmail={userEmail}
              threadId={message.threadId}
              messageId={message.id}
              labelIds={message.labelIds}
            />
          </div>
          <div className="ml-4 shrink-0">
            <Button
              color="white"
              loading={testing}
              onClick={async () => {
                await testEmail({
                  from: message.headers.from,
                  subject: message.headers.subject,
                  textHtml: message.textHtml || null,
                  textPlain: message.textPlain || null,
                  snippet: message.snippet || null,
                  threadId: message.threadId,
                  messageId: message.id,
                  date: message.internalDate || undefined,
                });
              }}
            >
              <SparklesIcon className="mr-2 h-4 w-4" />
              测试
            </Button>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Result coldEmailResponse={response} />
      </TableCell>
    </TableRow>
  );
}

function Result(props: { coldEmailResponse: ColdEmailBlockerResponse | null }) {
  const { coldEmailResponse } = props;

  if (!coldEmailResponse) return null;

  if (coldEmailResponse.isColdEmail) {
    return (
      <AlertBasic
        variant="destructive"
        title="这是一封冷邮件！"
        description={coldEmailResponse.aiReason}
      />
    );
  }

  let title = "我们的 AI 判定这不是冷邮件！";
  if (coldEmailResponse.reason === "hasPreviousEmail") {
    title = "此人之前给你发过邮件。这不是冷邮件！";
  } else if (coldEmailResponse.reason === "applicationSender") {
    title = "这是申请通知，不是冷邮件！";
  }

  return (
    <AlertBasic
      variant="success"
      title={title}
      description={coldEmailResponse.aiReason}
    />
  );
}

function useColdEmailTest() {
  const [testing, setTesting] = useState(false);
  const [response, setResponse] = useState<ColdEmailBlockerResponse | null>(
    null,
  );
  const { emailAccountId } = useAccount();

  const testEmail = async (data: ColdEmailBlockerBody) => {
    setTesting(true);
    try {
      const result = await testColdEmailAction(emailAccountId, data);
      if (result?.serverError) {
        toastError({
          title: "检查是否为冷邮件时出错。",
          description: result.serverError,
        });
      } else if (result?.data) {
        setResponse(result.data);
      }
    } finally {
      setTesting(false);
    }
  };

  return { testing, response, testEmail };
}
