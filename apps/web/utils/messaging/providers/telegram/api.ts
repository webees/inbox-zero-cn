type TelegramBotApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

export async function callTelegramBotApi<T>({
  botToken,
  apiMethod,
  body,
  requestMethod,
}: {
  botToken: string;
  apiMethod: string;
  body?: BodyInit;
  requestMethod?: "GET" | "POST";
}): Promise<T> {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/${apiMethod}`,
    {
      method: requestMethod ?? "POST",
      ...(body ? { body } : {}),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Telegram ${apiMethod} 请求失败（${response.status}）`);
  }

  const payload = (await response.json()) as TelegramBotApiResponse<T>;
  if (!payload.ok) {
    throw new Error(
      payload.description || `Telegram ${apiMethod} 返回了失败响应`,
    );
  }

  if (!("result" in payload)) {
    throw new Error(`Telegram ${apiMethod} 未返回结果数据`);
  }

  return payload.result as T;
}
