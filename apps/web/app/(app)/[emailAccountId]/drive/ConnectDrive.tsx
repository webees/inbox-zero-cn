"use client";

import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/providers/EmailAccountProvider";
import { toastError } from "@/components/Toast";
import { captureException } from "@/utils/error";
import type { GetDriveAuthUrlResponse } from "@/app/api/google/drive/auth-url/route";
import { fetchWithAccount } from "@/utils/fetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { redirectToSafeUrl } from "@/utils/redirect";

export function ConnectDrive() {
  const { t } = useLingui();
  const { emailAccountId } = useAccount();
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [isConnectingMicrosoft, setIsConnectingMicrosoft] = useState(false);
  const [googleDialogOpen, setGoogleDialogOpen] = useState(false);

  const handleConnectGoogle = async (access: "limited" | "full") => {
    setIsConnectingGoogle(true);
    try {
      const accessParam = access === "full" ? "?access=full" : "";
      const response = await fetchWithAccount({
        url: `/api/google/drive/auth-url${accessParam}`,
        emailAccountId,
        init: { headers: { "Content-Type": "application/json" } },
      });

      if (!response.ok) {
        throw new Error("无法发起 Google Drive 连接");
      }

      const data: GetDriveAuthUrlResponse = await response.json();

      if (!data?.url) throw new Error("无效的认证 URL");

      redirectToSafeUrl(data.url, { allowExternal: true });
    } catch (error) {
      captureException(error, {
        extra: { context: "Google Drive OAuth initiation" },
      });
      toastError({
        title: t`发起 Google Drive 连接时出错`,
        description: t`请重试或联系支持团队`,
      });
      setIsConnectingGoogle(false);
    }
  };

  const handleConnectMicrosoft = async () => {
    setIsConnectingMicrosoft(true);
    try {
      const response = await fetchWithAccount({
        url: "/api/outlook/drive/auth-url",
        emailAccountId,
        init: { headers: { "Content-Type": "application/json" } },
      });

      if (!response.ok) {
        throw new Error("无法发起 OneDrive 连接");
      }

      const data: GetDriveAuthUrlResponse = await response.json();

      if (!data?.url) throw new Error("无效的认证 URL");

      redirectToSafeUrl(data.url, { allowExternal: true });
    } catch (error) {
      captureException(error, {
        extra: { context: "OneDrive OAuth initiation" },
      });
      toastError({
        title: t`发起 OneDrive 连接时出错`,
        description: t`请重试或联系支持团队`,
      });
      setIsConnectingMicrosoft(false);
    }
  };

  return (
    <>
      <div className="flex gap-2 flex-wrap md:flex-nowrap">
        <Button
          onClick={() => setGoogleDialogOpen(true)}
          disabled={isConnectingGoogle || isConnectingMicrosoft}
          loading={isConnectingGoogle}
          variant="outline"
          className="flex items-center gap-2 w-full md:w-auto"
        >
          <Image
            src="/images/google.svg"
            alt="Google Drive"
            width={16}
            height={16}
            unoptimized
          />
          {isConnectingGoogle ? (
            <Trans>连接中...</Trans>
          ) : (
            <Trans>添加 Google Drive</Trans>
          )}
        </Button>

        <Button
          onClick={handleConnectMicrosoft}
          disabled={isConnectingGoogle || isConnectingMicrosoft}
          loading={isConnectingMicrosoft}
          variant="outline"
          className="flex items-center gap-2 w-full md:w-auto"
        >
          <Image
            src="/images/microsoft.svg"
            alt="OneDrive"
            width={16}
            height={16}
            unoptimized
          />
          {isConnectingMicrosoft ? (
            <Trans>连接中...</Trans>
          ) : (
            <Trans>添加 OneDrive</Trans>
          )}
        </Button>
      </div>

      <Dialog open={googleDialogOpen} onOpenChange={setGoogleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Trans>连接 Google Drive</Trans>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">
                  <Trans>标准</Trans>
                </p>
                <p className="text-xs text-muted-foreground">
                  <Trans>你需要为归档创建新文件夹</Trans>
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setGoogleDialogOpen(false);
                  handleConnectGoogle("limited");
                }}
                disabled={isConnectingGoogle}
                loading={isConnectingGoogle}
              >
                <Trans>连接</Trans>
              </Button>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">
                  <Trans>完全访问权限</Trans>
                </p>
                <p className="text-xs text-muted-foreground">
                  <Trans>使用现有文件夹</Trans>
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setGoogleDialogOpen(false);
                  handleConnectGoogle("full");
                }}
                disabled={isConnectingGoogle}
                loading={isConnectingGoogle}
              >
                <Trans>连接</Trans>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
