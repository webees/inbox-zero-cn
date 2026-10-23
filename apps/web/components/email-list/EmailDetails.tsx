import type { ThreadMessage } from "@/components/email-list/types";
import {
  extractEmailAddress,
  extractNameFromEmail,
  splitRecipientList,
} from "@/utils/email";

// 使用 span 而不是 div，让详情可以放在标题栏的切换按钮内。
export function EmailDetails({
  message,
  children,
}: {
  message: ThreadMessage;
  /** 显示在日期之后，例如用于隐藏这些详情的控件。 */
  children?: React.ReactNode;
}) {
  const headers = message.headers;

  const details = [
    { label: "发件人", value: headers?.from },
    { label: "收件人", value: headers?.to },
    { label: "抄送", value: headers?.cc },
    { label: "密送", value: headers?.bcc },
  ];

  return (
    <span className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-left text-sm leading-6">
      {details.map(
        ({ label, value }) =>
          value && (
            <span key={label} className="contents">
              <span className="text-muted-foreground">{label}</span>
              <span className="break-words">
                {splitRecipientList(value).map((recipient, index) => (
                  <span key={`${index}-${recipient}`}>
                    {index > 0 && ", "}
                    <Recipient recipient={recipient} />
                  </span>
                ))}
              </span>
            </span>
          ),
      )}
      <span className="col-span-full flex items-center gap-2 text-muted-foreground">
        {new Date(headers?.date ?? message.date).toLocaleString(undefined, {
          dateStyle: "full",
          timeStyle: "short",
        })}
        {children}
      </span>
    </span>
  );
}

function Recipient({ recipient }: { recipient: string }) {
  const email = extractEmailAddress(recipient);
  const name = extractNameFromEmail(recipient);

  if (!email || !name || name === email) {
    return (
      <span className="font-medium text-foreground">{email || recipient}</span>
    );
  }

  return (
    <>
      <span className="font-medium text-foreground">{name}</span>{" "}
      <span className="text-muted-foreground">&lt;{email}&gt;</span>
    </>
  );
}
