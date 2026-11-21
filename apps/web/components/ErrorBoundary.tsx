"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";
import { createClientLogger } from "@/utils/logger-client";

export class ErrorBoundary extends Component<
  {
    children: ReactNode;
    extra?: Record<string, unknown>;
    fallback?: ReactNode;
    logMessage?: string;
    logScope?: string;
  },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(_error: Error) {
    // 更新状态，使下一次渲染显示兜底 UI
    return { hasError: true };
  }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (this.props.logScope) {
      const logger = createClientLogger(this.props.logScope);

      logger.error(this.props.logMessage || "错误边界已触发", {
        errorMessage: error?.message,
        errorName: error?.name,
        ...this.props.extra,
      });
      logger.flush().catch(() => undefined);
    }

    Sentry.captureException(error, { ...errorInfo, extra: this.props.extra });
  }
  render() {
    if (this.state.hasError) return this.props.fallback ?? <div>出错了 :(</div>;

    return this.props.children;
  }
}
