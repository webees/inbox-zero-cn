"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { emailOtp, signIn } from "@/utils/auth-client";
import { buildRedirectUrl, redirectToSafeUrl } from "@/utils/redirect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function EmailOtpForm({ callbackURL }: { callbackURL: string }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    resetField,
    formState: { isSubmitting },
  } = useForm({ defaultValues: { email: "", code: "" } });

  const submit = handleSubmit(async ({ email, code }) => {
    setError(null);
    try {
      if (!sentTo) {
        const address = email.trim().toLowerCase();
        const result = await emailOtp.sendVerificationOtp({
          email: address,
          type: "sign-in",
        });
        if (result.error) {
          setError("无法发送验证码。请等待一分钟后重试。");
          return;
        }
        setSentTo(address);
      } else {
        const result = await signIn.emailOtp({
          email: sentTo,
          otp: code.trim(),
        });
        if (result.error) {
          setError("验证码无效或已过期。请检查验证码或重新获取。");
          return;
        }
        redirectToSafeUrl(callbackURL);
      }
    } catch {
      setError("无法登录。请重试。");
    }
  });

  return (
    <form className="space-y-6" onSubmit={submit}>
      <div className="space-y-2 text-center">
        <h1 className="font-title text-2xl">
          {sentTo ? "查看你的邮箱" : "使用邮箱登录"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {sentTo ? "输入你的 6 位验证码。" : "邮箱登录必须在设置中启用。"}
        </p>
      </div>
      {sentTo ? (
        <div className="space-y-2">
          <Label htmlFor="login-code">登录验证码</Label>
          <Input
            id="login-code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            {...register("code")}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="login-email">邮箱</Label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            required
            {...register("email")}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button className="w-full" type="submit" loading={isSubmitting}>
        {sentTo ? "登录" : "发送验证码"}
      </Button>
      {sentTo ? (
        <Button
          className="w-full"
          type="button"
          variant="ghost"
          disabled={isSubmitting}
          onClick={() => {
            setSentTo(null);
            setError(null);
            resetField("code");
          }}
        >
          返回
        </Button>
      ) : (
        <Button className="w-full" variant="ghost" asChild>
          <Link
            href={buildRedirectUrl("/login/options", { next: callbackURL })}
          >
            返回
          </Link>
        </Button>
      )}
    </form>
  );
}
