export function escapeTelegramMarkdown(text: string): string {
  return text.replace(/([\\_*`[\]()])/g, "\\$1");
}

export function markdownToTelegramText(text: string): string {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\\\n/g, "\n")
    .split("\n")
    .map(normalizeTelegramLine)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized;
}

function normalizeTelegramLine(line: string): string {
  return (
    line
      // Markdown 硬换行标记。
      .replace(/\\$/, "")
      // 模型 markdown 回复中的列表标记。
      .replace(/^(\s*)\\?[*-]\s+/, "$1• ")
      // 标题标记。
      .replace(/^#{1,6}\s+/, "")
      // Markdown 链接。
      .replace(/\[([^[\]]+)\]\(([^()\s]+)\)/g, "$1: $2")
      // Markdown 转义。
      .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1")
      // 加粗/斜体/代码。
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      // 单字符斜体（在列表转换之后）。
      .replace(/(^|[\s([{>])\*([^*\n]+)\*(?=$|[\s)\]}>.,!?;:])/g, "$1$2")
      .replace(/(^|[\s([{>])_([^_\n]+)_(?=$|[\s)\]}>.,!?;:])/g, "$1$2")
      // 清理部分损坏的 markdown 标记。
      .replace(/\*\*/g, "")
      .replace(/__+/g, "")
  );
}
