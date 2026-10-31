/**
 * 将 @[LABEL] 提及格式转换为纯 LABEL，以便 AI 处理
 * 这会剥离编辑器使用的特殊 markdown 格式，
 * 让 AI 收到不含提及语法的干净标签名称
 */
export function convertMentionsToLabels(promptFile: string): string {
  return processMentions(promptFile, (match) => match);
}

/**
 * 将 @[LABEL] 格式转换为 "LABEL" 以便在 UI 中展示
 * 这是 convertMentionsToLabels 的逆操作
 */
export function convertLabelsToDisplay(text: string): string {
  return processMentions(text, (match) => `"${match}"`);
}

/**
 * 处理提及并进行正确括号匹配的辅助函数
 */
function processMentions(
  text: string,
  transformer: (match: string) => string,
): string {
  let result = "";
  let i = 0;

  while (i < text.length) {
    // 查找 @[
    if (i < text.length - 1 && text[i] === "@" && text[i + 1] === "[") {
      // 找到提及的开始位置，查找匹配的右括号
      let bracketCount = 1;
      let j = i + 2;

      while (j < text.length && bracketCount > 0) {
        if (text[j] === "[") {
          bracketCount++;
        } else if (text[j] === "]") {
          bracketCount--;
        }
        j++;
      }

      if (bracketCount === 0) {
        // 找到匹配的右括号
        const labelContent = text.slice(i + 2, j - 1);
        result += transformer(labelContent);
        i = j;
      } else {
        // 未找到匹配的括号，按普通文本处理
        result += text[i];
        i++;
      }
    } else {
      result += text[i];
      i++;
    }
  }

  return result;
}
