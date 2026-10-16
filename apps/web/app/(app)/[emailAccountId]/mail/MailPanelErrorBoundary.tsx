"use client";

import { Component, type ReactNode } from "react";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";

type Props = {
  children: ReactNode;
  resetKey: string;
  title: string;
  onBack?: () => void;
};

export class MailPanelErrorBoundary extends Component<
  Props,
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(previousProps: Props) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-0 min-w-0 flex-1 overflow-auto" role="alert">
          <AppErrorBoundary
            error={this.state.error}
            reset={this.reset}
            title={this.props.title}
            description="请重试，或选择其他文件夹或会话。如果问题仍然存在，请使用下方的参考信息联系支持人员。"
            onBack={this.props.onBack}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
