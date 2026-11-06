"use client";

import { useState } from "react";
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

      if (!data?.url) throw new Error("无效的授权 URL");

      redirectToSafeUrl(data.url, { allowExternal: true });
    } catch (error) {
      captureException(error, {
        extra: { context: "Google Drive OAuth 发起" },
      });
      toastError({
        title: "发起 Google Drive 连接时出错",
        description: "请重试或联系支持人员",
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

      if (!data?.url) throw new Error("无效的授权 URL");

      redirectToSafeUrl(data.url, { allowExternal: true });
    } catch (error) {
      captureException(error, {
        extra: { context: "OneDrive OAuth 发起" },
      });
      toastError({
        title: "发起 OneDrive 连接时出错",
        description: "请重试或联系支持人员",
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
          {isConnectingGoogle ? "正在连接…" : "添加 Google Drive"}
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
          {isConnectingMicrosoft ? "正在连接…" : "添加 OneDrive"}
        </Button>
      </div>

      <Dialog open={googleDialogOpen} onOpenChange={setGoogleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>连接 Google Drive</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">标准</p>
                <p className="text-xs text-muted-foreground">
                  你需要为归档创建新文件夹
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
                连接
              </Button>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">完全访问权限</p>
                <p className="text-xs text-muted-foreground">
                  使用你现有的文件夹
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
                连接
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
