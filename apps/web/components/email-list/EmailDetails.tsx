import type { ThreadMessage } from "@/components/email-list/types";

export function EmailDetails({ message }: { message: ThreadMessage }) {
  const headers = message.headers;

  const details = [
    { label: "发件人", value: headers?.from },
    { label: "收件人", value: headers?.to },
    { label: "抄送", value: headers?.cc },
    { label: "密送", value: headers?.bcc },
  ];

  return (
    <div className="mb-4 text-xs leading-relaxed">
      <div className="grid gap-1">
        {details.map(
          ({ label, value }) =>
            value && (
              <div
                key={label}
                className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2"
              >
                <span className="text-muted-foreground">{label}</span>
                <span className="break-words text-foreground">{value}</span>
              </div>
            ),
        )}
      </div>
      <div className="mt-1 text-muted-foreground">
        {new Date(headers?.date ?? message.date).toLocaleString(undefined, {
          dateStyle: "full",
          timeStyle: "short",
        })}
      </div>
    </div>
  );
}
