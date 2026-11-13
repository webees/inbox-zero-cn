"use client";

import { useChat as useAiChat } from "@ai-sdk/react";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { DefaultChatTransport } from "ai";
import { parseAsString, useQueryState } from "nuqs";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSWRConfig } from "swr";
import { captureException } from "@/utils/error";
import { toastError } from "@/components/Toast";
import { convertToUIMessages } from "@/components/assistant-chat/helpers";
import type { ChatMessage } from "@/components/assistant-chat/types";
import { useChatMessages } from "@/hooks/useChatMessages";
import { useAccount } from "@/providers/EmailAccountProvider";
import {
  CHAT_ACCOUNT_MISMATCH_ERROR_CODE,
  EMAIL_ACCOUNT_HEADER,
} from "@/utils/config";
import type {
  MailViewContext,
  MessageContext,
} from "@/utils/ai/assistant/chat-context-validation";
import { InlineEmailActionProvider } from "@/components/assistant-chat/inline-email-action-context";
import {
  mergeInlineEmailActions,
  type InlineEmailAction,
  type InlineEmailActionType,
} from "@/utils/ai/assistant/inline-email-actions";
import {
  ASSISTANT_CHAT_MAX_TEXT_LENGTH,
  ASSISTANT_CHAT_MAX_TEXT_LENGTH_MESSAGE,
} from "@/utils/actions/assistant-chat.validation";
import { createClientLogger } from "@/utils/logger-client";
import {
  type MailScreenAction,
  parseMailScreenAction,
} from "@/utils/ai/assistant/mail-screen-action";

const logger = createClientLogger("assistant-chat");

const CHAT_SEND_FAILED_MESSAGE = msg`无法发送你的消息，请重试。`;
const CHAT_ACCOUNT_MISMATCH_MESSAGE = msg`该对话属于另一个邮箱账号，因此我们已开始一个新对话。请重新发送你的消息。`;

export type Attachment = {
  id: string;
  name: string;
  url: string;
  contentType: string;
};

export type Chat = ReturnType<typeof useAiChat<ChatMessage>>;

type ChatMessagePart =
  | { type: "file"; url: string; filename: string; mediaType: string }
  | { type: "text"; text: string };

type ChatSendError = {
  chatId: string;
  message: string;
  offerNewChat: boolean;
};

type PendingChatRequest = {
  // 服务器返回 OK 即表示消息已保存；后续失败会在回复中显示，而不是报告为未发送。
  accepted?: boolean;
  attachmentCount: number;
  chatId: string;
  // 消息从未到达服务器时由 onError 设置。
  sendError?: Error;
  textLength: number;
};

type ChatContextType = {
  chat: Chat;
  input: string;
  chatId: string | null;
  persistedMessageIds: Set<string>;
  sendError: Omit<ChatSendError, "chatId"> | null;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  setChatId: (chatId: string | null) => void;
  setNewChat: () => void;
  submitTextMessage: (text: string) => Promise<void>;
  handleSubmit: () => void;
  stop: () => Promise<void>;
  context: MessageContext | null;
  setContext: (context: MessageContext | null) => void;
  setAmbientContext: (context: MessageContext | null) => void;
  setMailView: (mailView: MailViewContext | null) => void;
  setMailScreenActionHandler: (
    handler: ((action: MailScreenAction) => void) | null,
  ) => void;
  attachments: Attachment[];
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
};

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { i18n } = useLingui();
  const { emailAccountId } = useAccount();
  const { mutate } = useSWRConfig();

  const [input, setInput] = useState<string>("");
  const [chatId, setChatId] = useQueryState("chatId", parseAsString);
  const [context, setContext] = useState<MessageContext | null>(null);
  const [ambientContext, setAmbientContext] = useState<MessageContext | null>(
    null,
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sendError, setSendError] = useState<ChatSendError | null>(null);
  const [inlineActions, setInlineActions] = useState<InlineEmailAction[]>([]);
  const inlineActionsRef = useRef(inlineActions);
  const pendingInlineActionsRef = useRef<InlineEmailAction[] | null>(null);
  // 只在发送时读取，因此页面切换不会重新渲染对话。
  const mailViewRef = useRef<MailViewContext | null>(null);
  const mailScreenActionHandlerRef = useRef<
    ((action: MailScreenAction) => void) | null
  >(null);
  // 恢复的运行会重放工具结果；每个分组只显示一次。
  const shownSplitCallIdsRef = useRef(new Set<string>());
  const pendingRequestRef = useRef<PendingChatRequest | null>(null);
  const pendingRequestContextRef = useRef<MessageContext | null>(null);
  const previousChatIdRef = useRef(chatId);
  const previousEmailAccountIdRef = useRef<string | null>(null);
  // 明确停止后，直到用户再次发送前都不要重新连接。
  const stoppedRef = useRef(false);
  // 发送失败或在回复中途断开；服务端可能仍在运行。
  const interruptedRef = useRef(false);
  const resumingRef = useRef(false);
  const resumedStreamIdRef = useRef<string | null>(null);
  const messagesAtHideRef = useRef<unknown>(null);

  // 每当 `id` 变化时，useChat 都会替换（并停止）其 Chat，因此新对话
  // 需要在首次发送将其采用到 URL 之前拥有自己的 id。采用后轮换一次，
  // 这样之后清空 chatId 时会开始一个新对话。
  const [draftChatId, setDraftChatId] = useState(generateUUID);
  if (chatId === draftChatId) setDraftChatId(generateUUID());

  const { data, error: chatLoadError } = useChatMessages(chatId);
  const persistedMessageIds = useMemo(
    () => new Set(data?.messages.map((message) => message.id) ?? []),
    [data?.messages],
  );

  const setNewChat = useCallback(() => {
    setChatId(generateUUID());
  }, [setChatId]);

  const showSendError = useCallback((error: ChatSendError) => {
    setSendError(error);
    toastError({ description: error.message });
  }, []);

  const queueInlineAction = useCallback(
    (type: InlineEmailActionType, threadIds: string[]) => {
      setInlineActions((current) =>
        mergeInlineEmailActions(current, { type, threadIds }),
      );
    },
    [],
  );

  const chat = useAiChat<ChatMessage>({
    id: chatId ?? draftChatId,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      headers: {
        [EMAIL_ACCOUNT_HEADER]: emailAccountId,
      },
      fetch: async (input, init) => {
        const request = pendingRequestRef.current;
        const response = await fetch(input, init);
        // 重连会共享这次 fetch；只有发送 POST 会保存消息。
        if (response.ok && request && init?.method === "POST")
          request.accepted = true;
        return response;
      },
      prepareSendMessagesRequest({ messages, id, body }) {
        return {
          body: {
            id,
            message: messages.at(-1),
            supportsInlineEmailCards: true,
            inlineActions: pendingInlineActionsRef.current ?? undefined,
            mailView: mailViewRef.current ?? undefined,
            ...body,
          },
        };
      },
    }),
    // messages: initialMessages, // 注意：没能让这个生效
    experimental_throttle: 100,
    generateId: generateUUID,
    // 仅对流式调用触发，不针对历史记录。恢复的运行会从其第一个分块开始重放，
    // 因此会跳过这些调用，而不是在用户于页面上所做的操作之上重新应用。
    onToolCall: ({ toolCall }) => {
      if (toolCall.dynamic || toolCall.toolName !== "controlMailScreen") return;
      if (resumingRef.current) return;
      const action = parseMailScreenAction(toolCall.input);
      if ("error" in action) return;
      mailScreenActionHandlerRef.current?.(action);
    },
    onFinish: async ({ message, isAbort }) => {
      pendingInlineActionsRef.current = null;
      pendingRequestRef.current = null;
      pendingRequestContextRef.current = null;
      const splitChange = getSplitInboxChange(message);
      // 中断可能是停止或重新连接，它们会在服务器保存回复后重新获取；
      // 现在重新获取会丢失当前显示的部分回复。
      await Promise.all([
        mutate("/api/user/rules"),
        splitChange ? mutate("/api/mail/settings") : Promise.resolve(),
        chatId && !isAbort ? mutate(`/api/chats/${chatId}`) : Promise.resolve(),
      ]);
      // 显示分组就是预览：用户可以看到它匹配了什么，
      // 并可以要求修改或删除。
      const shown = splitChange?.shown;
      if (shown && !shownSplitCallIdsRef.current.has(shown.toolCallId)) {
        shownSplitCallIdsRef.current.add(shown.toolCallId);
        mailScreenActionHandlerRef.current?.({
          action: "show_split",
          splitId: shown.splitId,
          emailAccountId,
        });
      }
    },
    onError: (error) => {
      if (resumingRef.current) {
        interruptedRef.current = true;
        logger.warn("AI 助手对话恢复失败", {
          chatId: chatId ?? chat.id,
          errorName: error.name,
        });
        return;
      }

      const isAccountMismatch = isChatAccountMismatchError(error);
      interruptedRef.current = !isAccountMismatch;
      if (document.visibilityState === "visible" && !isAccountMismatch)
        resumeActiveRun();

      // 服务器接受请求后就已经拥有该消息，因此连接断开时会重新连接，
      // 而不是报告为未发送。
      if (chat.status === "streaming" || pendingRequestRef.current?.accepted) {
        pendingInlineActionsRef.current = null;
        pendingRequestRef.current = null;
        pendingRequestContextRef.current = null;
        logger.warn("AI 助手对话流已中断", {
          chatId: chatId ?? chat.id,
          errorName: error.name,
        });
        return;
      }

      const pendingRequest = pendingRequestRef.current;
      const pendingInlineActions = pendingInlineActionsRef.current;
      const pendingContext = pendingRequestContextRef.current;
      if (pendingContext?.type === "fix-rule") {
        setContext((current) => current ?? pendingContext);
      }
      if (pendingInlineActions?.length) {
        setInlineActions((current) =>
          pendingInlineActions.reduce(
            (merged, action) => mergeInlineEmailActions(merged, action),
            current,
          ),
        );
        pendingInlineActionsRef.current = null;
      }

      if (pendingRequest) pendingRequest.sendError = error;
      pendingRequestRef.current = null;
      pendingRequestContextRef.current = null;

      if (isAccountMismatch) {
        logger.warn("AI 助手对话属于另一个邮箱账号", {
          chatId: pendingRequest?.chatId ?? chatId ?? chat.id,
          emailAccountId,
        });
        // 未发送的消息会回到输入框中，因此新对话可以让用户重新发送，
        // 而不是每次重试都失败。
        const newChatId = generateUUID();
        setChatId(newChatId);
        showSendError({
          chatId: newChatId,
          message: i18n._(CHAT_ACCOUNT_MISMATCH_MESSAGE),
          offerNewChat: false,
        });
        return;
      }

      reportChatRequestError({
        emailAccountId,
        error,
        fallbackChatId: chatId ?? chat.id,
        request: pendingRequest,
      });
      showSendError({
        chatId: pendingRequest?.chatId ?? chatId ?? chat.id,
        message: getChatSendErrorMessage(error, i18n),
        offerNewChat: true,
      });
    },
  });

  const isRunActive =
    chat.status === "submitted" || chat.status === "streaming";

  // URL 可能带有另一个账号的对话（例如旧链接）。向它发送
  // 永远不会成功，因此改为开始一个新对话。
  const isLoadedChatFromOtherAccount =
    chatLoadError?.info?.errorCode === CHAT_ACCOUNT_MISMATCH_ERROR_CODE;
  useEffect(() => {
    // 已在进行的发送会以相同的不匹配错误失败，并在 onError 中恢复；
    // 此时切换对话会中止它并丢失未发送的消息。
    if (!chatId || !isLoadedChatFromOtherAccount || isRunActive) return;
    logger.warn("AI 助手对话属于另一个邮箱账号", {
      chatId,
      emailAccountId,
    });
    const newChatId = generateUUID();
    setChatId(newChatId);
    // 继续显示刚刚结束的发送失败原因。
    setSendError((current) =>
      current?.chatId === chatId ? { ...current, chatId: newChatId } : current,
    );
  }, [
    chatId,
    emailAccountId,
    isLoadedChatFromOtherAccount,
    isRunActive,
    setChatId,
  ]);

  const handledDataRef = useRef<{ chatId: string; data: typeof data } | null>(
    null,
  );

  useEffect(() => {
    const handled = handledDataRef.current;
    if (handled?.chatId === chat.id && handled.data === data) return;
    handledDataRef.current = { chatId: chat.id, data };
    // 回复只在运行结束时保存，因此运行中途获取的数据（例如窗口聚焦时）
    // 会落后于本地消息。运行结束时 onFinish 会重新获取，从而载入已保存的回复。
    if (isRunActive) return;
    chat.setMessages(data ? convertToUIMessages(data) : []);
  }, [chat.id, chat.setMessages, data, isRunActive]);

  const resumeActiveRun = useCallback(async () => {
    if (!chatId || stoppedRef.current || resumingRef.current) return;

    resumingRef.current = true;
    interruptedRef.current = false;
    try {
      // 先丢弃停滞的请求，确保两个流永远不会同时写入回复。
      await chat.stop();
      await chat.resumeStream();
    } finally {
      resumingRef.current = false;
    }
    await mutate(`/api/chats/${chatId}`);
  }, [chat.resumeStream, chat.stop, chatId, mutate]);

  // 当已保存的消息显示后，重新连接到此对话仍在进行的回复，例如在刷新后
  // 或在运行中途打开对话时。
  const activeStreamId = data?.activeStreamId ?? null;
  useEffect(() => {
    if (!activeStreamId || resumedStreamIdRef.current === activeStreamId)
      return;
    if (chat.status === "submitted" || chat.status === "streaming") return;
    if (chat.messages.at(-1)?.id === activeStreamId) return;

    resumedStreamIdRef.current = activeStreamId;
    resumeActiveRun();
  }, [activeStreamId, chat.messages, chat.status, resumeActiveRun]);

  // 移动端浏览器会在回复继续进行时断开后台标签页的连接，
  // 因此当标签页恢复时重新连接。
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        messagesAtHideRef.current = chat.messages;
        return;
      }

      const stalled =
        chat.status === "streaming" &&
        chat.messages === messagesAtHideRef.current;
      if (interruptedRef.current || stalled) resumeActiveRun();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [chat.messages, chat.status, resumeActiveRun]);

  useEffect(() => {
    inlineActionsRef.current = inlineActions;
  }, [inlineActions]);

  useEffect(() => {
    if (previousChatIdRef.current === chatId) return;

    previousChatIdRef.current = chatId;
    stoppedRef.current = false;
    interruptedRef.current = false;
    if (pendingRequestRef.current?.chatId === chatId) return;

    pendingInlineActionsRef.current = null;
    pendingRequestRef.current = null;
    pendingRequestContextRef.current = null;
    setInlineActions([]);
  }, [chatId]);

  useEffect(() => {
    if (!emailAccountId) return;

    if (previousEmailAccountIdRef.current === null) {
      previousEmailAccountIdRef.current = emailAccountId;
      return;
    }

    if (previousEmailAccountIdRef.current === emailAccountId) return;

    previousEmailAccountIdRef.current = emailAccountId;
    pendingInlineActionsRef.current = null;
    pendingRequestRef.current = null;
    pendingRequestContextRef.current = null;
    setChatId(null);
    chat.setMessages([]);
    setInput("");
    setContext(null);
    setAmbientContext(null);
    setAttachments([]);
    setInlineActions([]);
  }, [chat.setMessages, emailAccountId, setChatId]);

  const setMailView = useCallback((mailView: MailViewContext | null) => {
    mailViewRef.current = mailView;
  }, []);

  const setMailScreenActionHandler = useCallback(
    (handler: ((action: MailScreenAction) => void) | null) => {
      mailScreenActionHandlerRef.current = handler;
    },
    [],
  );

  const setDisplayedContext = useCallback((next: MessageContext | null) => {
    setContext(next);
    if (!next) setAmbientContext(null);
  }, []);

  const sendMessageParts = useCallback(
    (parts: ChatMessagePart[]) => {
      const textLength = getChatTextLength(parts);
      const attachmentCount = parts.filter(
        (part) => part.type === "file",
      ).length;

      if (textLength > ASSISTANT_CHAT_MAX_TEXT_LENGTH) {
        logger.warn("AI 助手对话输入被拒绝", {
          attachmentCount,
          chatId: chatId ?? chat.id,
          emailAccountId,
          failureCategory: "message_too_long",
          maxTextLength: ASSISTANT_CHAT_MAX_TEXT_LENGTH,
          statusCode: null,
          textLength,
        });
        logger.flush().catch(() => undefined);
        toastError({ description: getMaxTextLengthMessage(i18n) });
        throw new ChatInputValidationError();
      }

      if (!chatId) setChatId(chat.id);
      setSendError(null);
      stoppedRef.current = false;
      interruptedRef.current = false;

      const requestChatId = chatId ?? chat.id;
      const requestContext = context ?? ambientContext;
      const request: PendingChatRequest = {
        attachmentCount,
        chatId: requestChatId,
        textLength,
      };
      pendingRequestRef.current = request;
      pendingRequestContextRef.current = requestContext;
      pendingInlineActionsRef.current = inlineActionsRef.current.length
        ? inlineActionsRef.current
        : null;

      if (pendingInlineActionsRef.current) {
        setInlineActions([]);
      }

      // 即使请求失败，sendMessage 也会解析（它通过 onError 报告），
      // 因此在此处拒绝，以便调用方保留未发送的消息。
      // 流式传输开始后的中止和断开不算发送失败。
      const sendPromise = chat
        .sendMessage(
          { role: "user", parts },
          requestContext ? { body: { context: requestContext } } : undefined,
        )
        .then(() => {
          if (request.sendError) throw request.sendError;
        });
      if (requestContext) {
        setContext((current) => (current === requestContext ? null : current));
      }

      return sendPromise;
    },
    [
      chat.id,
      chat.sendMessage,
      chatId,
      context,
      ambientContext,
      emailAccountId,
      i18n,
      setChatId,
    ],
  );

  const submitTextMessage = useCallback(
    async (text: string) => {
      const trimmedText = text.trim();
      if (!trimmedText) return;

      await sendMessageParts([{ type: "text", text: trimmedText }]);
      setInput("");
    },
    [sendMessageParts],
  );

  const stop = useCallback(async () => {
    stoppedRef.current = true;
    interruptedRef.current = false;
    if (!chatId) {
      await chat.stop();
      return;
    }

    // 回复的消息 ID 就是其流 ID；发送它可避免迟到的停止操作取消更新的回复。
    const lastMessage = chat.messages.at(-1);
    const activeStreamId =
      lastMessage?.role === "assistant" &&
      !persistedMessageIds.has(lastMessage.id)
        ? lastMessage.id
        : undefined;

    const stopRequest = fetch(`/api/chat/${chatId}/stop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [EMAIL_ACCOUNT_HEADER]: emailAccountId,
      },
      body: JSON.stringify({ activeStreamId }),
    });
    await chat.stop();

    try {
      const response = await stopRequest;
      if (!response.ok) throw new Error(`状态码 ${response.status}`);
    } catch (error) {
      logger.warn("停止 AI 助手对话运行失败", {
        chatId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    await mutate(`/api/chats/${chatId}`);
  }, [
    chat.messages,
    chat.stop,
    chatId,
    emailAccountId,
    mutate,
    persistedMessageIds,
  ]);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    const submittedInput = input;
    const submittedAttachments = attachments;

    const fileParts = attachments.map((attachment) => ({
      type: "file" as const,
      url: attachment.url,
      filename: attachment.name,
      mediaType: attachment.contentType,
    }));

    const parts: ChatMessagePart[] = [...fileParts];

    if (text) {
      parts.push({ type: "text", text });
    }

    let sendPromise: Promise<void>;
    try {
      sendPromise = sendMessageParts(parts);
    } catch (error) {
      if (!(error instanceof ChatInputValidationError)) {
        reportChatRequestError({
          emailAccountId,
          error,
          fallbackChatId: chatId ?? chat.id,
          request: pendingRequestRef.current,
        });
        showSendError({
          chatId: chatId ?? chat.id,
          message: i18n._(CHAT_SEND_FAILED_MESSAGE),
          offerNewChat: true,
        });
      }
      return;
    }

    setAttachments([]);
    setInput("");
    sendPromise.catch(() => {
      setInput((current) =>
        current ? `${submittedInput}\n\n${current}` : submittedInput,
      );
      setAttachments((current) =>
        mergeAttachments(submittedAttachments, current),
      );
    });
  }, [
    attachments,
    chat.id,
    chatId,
    emailAccountId,
    i18n,
    input,
    sendMessageParts,
    showSendError,
  ]);

  return (
    <ChatContext.Provider
      value={{
        chat,
        chatId,
        input,
        persistedMessageIds,
        sendError:
          sendError?.chatId === chat.id
            ? {
                message: sendError.message,
                offerNewChat: sendError.offerNewChat,
              }
            : null,
        setInput,
        setChatId,
        setNewChat,
        submitTextMessage,
        handleSubmit,
        stop,
        context: context ?? ambientContext,
        setContext: setDisplayedContext,
        setAmbientContext,
        setMailView,
        setMailScreenActionHandler,
        attachments,
        setAttachments,
      }}
    >
      <InlineEmailActionProvider value={{ queueAction: queueInlineAction }}>
        {children}
      </InlineEmailActionProvider>
    </ChatContext.Provider>
  );
}

export function useChat(): ChatContextType {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChat 必须在 ChatProvider 内使用");
  }
  return context;
}

// 注意：不清楚为什么我们不直接使用 AI SDK 的默认值
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getChatTextLength(parts: ChatMessagePart[]) {
  return parts.reduce(
    (length, part) => length + (part.type === "text" ? part.text.length : 0),
    0,
  );
}

function mergeAttachments(
  submitted: Attachment[],
  current: Attachment[],
): Attachment[] {
  const currentIds = new Set(current.map((attachment) => attachment.id));
  return [
    ...submitted.filter((attachment) => !currentIds.has(attachment.id)),
    ...current,
  ];
}

class ChatInputValidationError extends Error {
  constructor() {
    super(ASSISTANT_CHAT_MAX_TEXT_LENGTH_MESSAGE);
    this.name = "ChatInputValidationError";
  }
}

function reportChatRequestError({
  emailAccountId,
  error,
  fallbackChatId,
  request,
}: {
  emailAccountId: string;
  error: unknown;
  fallbackChatId: string;
  request: PendingChatRequest | null;
}) {
  logger.error("AI 助手对话请求失败", {
    attachmentCount: request?.attachmentCount ?? 0,
    chatId: request?.chatId ?? fallbackChatId,
    emailAccountId,
    errorName: error instanceof Error ? error.name : "UnknownError",
    failureCategory: "request_error",
    statusCode: getErrorStatusCode(error),
    textLength: request?.textLength ?? 0,
  });
  logger.flush().catch(() => undefined);
  console.error(error);
  captureException(error);
}

function getErrorStatusCode(error: unknown) {
  if (!error || typeof error !== "object") return null;

  const statusCode = (error as Record<string, unknown>).statusCode;
  return typeof statusCode === "number" ? statusCode : null;
}

function isChatAccountMismatchError(error: unknown) {
  return (
    getChatRequestErrorBody(error)?.errorCode ===
    CHAT_ACCOUNT_MISMATCH_ERROR_CODE
  );
}

function getChatSendErrorMessage(error: unknown, i18n: I18n) {
  const statusCode = getErrorStatusCode(error);
  const serverMessage = getChatRequestErrorBody(error)?.error;
  // 4xx 响应说明用户可以做什么；5xx 响应正文不适合展示给用户。
  if (
    statusCode !== null &&
    statusCode < 500 &&
    typeof serverMessage === "string" &&
    serverMessage.trim()
  ) {
    if (serverMessage === ASSISTANT_CHAT_MAX_TEXT_LENGTH_MESSAGE)
      return getMaxTextLengthMessage(i18n);
    return serverMessage;
  }
  return i18n._(CHAT_SEND_FAILED_MESSAGE);
}

function getChatRequestErrorBody(
  error: unknown,
): Record<string, unknown> | null {
  if (!error || typeof error !== "object") return null;
  const responseBody = (error as Record<string, unknown>).responseBody;
  if (typeof responseBody !== "string") return null;

  try {
    const body: unknown = JSON.parse(responseBody);
    return body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * 此回复中助手是否更改了拆分，以及它创建或编辑的最后一个拆分；后续删除其他拆分不会将其隐藏。
 */
function getSplitInboxChange(
  message: ChatMessage,
): { shown?: { toolCallId: string; splitId: string } } | null {
  let changed = false;
  let shown: { toolCallId: string; splitId: string } | undefined;
  for (const part of message.parts) {
    if (part.type !== "tool-manageSplitInbox") continue;
    if (part.state !== "output-available" || !part.output.success) continue;
    if (!("action" in part.output)) continue;
    changed = true;
    const splitId = "split" in part.output ? part.output.split?.id : undefined;
    if (splitId) shown = { toolCallId: part.toolCallId, splitId };
  }
  return changed ? { shown } : null;
}

function getMaxTextLengthMessage(i18n: I18n) {
  const maxLength = i18n.number(ASSISTANT_CHAT_MAX_TEXT_LENGTH);
  return i18n._(msg`消息最多可达 ${maxLength} 个字符。`);
}
