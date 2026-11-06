import type React from "react";
import { Loading } from "./Loading";
import { ErrorDisplay } from "./ErrorDisplay";

interface LoadingContentProps {
  children: React.ReactNode;
  error?: {
    info?: { error?: string; isKnownError?: boolean };
    error?: string;
    status?: number;
  };
  errorComponent?: React.ReactNode;
  loading: boolean;
  loadingComponent?: React.ReactNode;
}

export function LoadingContent(props: LoadingContentProps) {
  const ignoreError = shouldIgnoreError(props.error);

  if (props.error && !ignoreError) {
    return props.errorComponent ? (
      props.errorComponent
    ) : (
      <div className="mt-4">
        <ErrorDisplay error={props.error} />
      </div>
    );
  }

  // 在开发模式下遇到被忽略的错误时，重试期间显示加载状态
  if (props.loading || ignoreError)
    return <>{props.loadingComponent || <Loading />}</>;

  return <>{props.children}</>;
}

// 在开发环境中忽略 404 错误（很可能是短暂的 HMR 错误），
// 除非 API 是有意发送该错误且需要用户看到。
function shouldIgnoreError(error: LoadingContentProps["error"]): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  if (error?.info?.isKnownError) return false;
  return error?.status === 404;
}
