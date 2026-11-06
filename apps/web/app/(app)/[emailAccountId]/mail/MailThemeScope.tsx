"use client";

import { useEffect } from "react";

/**
 * 通过在文档根节点上标记 `data-theme="mail"` 来应用 Mail 调色板。
 *
 * 必须是根节点而非包裹元素：Radix 会把下拉菜单、对话框与
 * 提示渲染到 <body> 上的 portal 中，因此作用域仅限包裹元素的主题
 * 会让每个弹出层都以此屏幕应用的默认调色板绘制。
 *
 * next-themes 通过 class 驱动深色模式，因此使用属性不会冲突。
 */
export function MailThemeScope() {
  useEffect(() => {
    const { documentElement } = document;
    const previous = documentElement.dataset.theme;
    documentElement.dataset.theme = "mail";

    return () => {
      if (previous === undefined) delete documentElement.dataset.theme;
      else documentElement.dataset.theme = previous;
    };
  }, []);

  return null;
}
