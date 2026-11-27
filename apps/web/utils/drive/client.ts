import { auth } from "@googleapis/drive";
import { env } from "@/env";
import {
  fetchGoogleOpenIdProfile,
  getGoogleOauthClientOptions,
  isGoogleOauthEmulationEnabled,
} from "@/utils/gmail/oauth";
import {
  fetchMicrosoftUserProfile,
  getMicrosoftOauthAuthorizeUrl,
  requestMicrosoftToken,
} from "@/utils/outlook/oauth";
import {
  GOOGLE_DRIVE_FULL_SCOPES,
  GOOGLE_DRIVE_SCOPES,
  MICROSOFT_DRIVE_SCOPES,
} from "./scopes";

// ============================================================================
// Google Drive OAuth
// ============================================================================

/**
 * 为 Google Drive 认证创建 OAuth2 客户端
 */
export function getGoogleDriveOAuth2Client() {
  return new auth.OAuth2(
    getGoogleOauthClientOptions(
      `${env.NEXT_PUBLIC_BASE_URL}/api/google/drive/callback`,
    ),
  );
}

/**
 * 为 Google Drive 生成 OAuth2 URL
 */
export type GoogleDriveAccessLevel = "limited" | "full";

export function getGoogleDriveOAuth2Url(
  state: string,
  accessLevel: GoogleDriveAccessLevel = "limited",
): string {
  const oauth2Client = getGoogleDriveOAuth2Client();
  const scopes =
    accessLevel === "full" ? GOOGLE_DRIVE_FULL_SCOPES : GOOGLE_DRIVE_SCOPES;
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [...scopes],
    state,
    prompt: "consent",
  });
}

/**
 * 用 Google OAuth code 换取令牌
 */
export async function exchangeGoogleDriveCode(code: string) {
  const oauth2Client = getGoogleDriveOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Google 未返回 access 或 refresh token");
  }

  const profile = isGoogleOauthEmulationEnabled()
    ? await fetchGoogleOpenIdProfile(tokens.access_token)
    : await verifyGoogleIdTokenPayload(oauth2Client, tokens.id_token);
  const email = profile.email;

  if (!email) {
    throw new Error("无法从 Google 资料获取邮箱");
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    email,
  };
}

async function verifyGoogleIdTokenPayload(
  oauth2Client: ReturnType<typeof getGoogleDriveOAuth2Client>,
  idToken: string | null | undefined,
) {
  if (!idToken) {
    throw new Error("Google 未返回 ID token");
  }

  const ticket = await oauth2Client.verifyIdToken({
    idToken,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();

  if (!payload?.email) {
    throw new Error("无法从 Google ID token 获取邮箱");
  }

  return payload;
}

// ============================================================================
// Microsoft OneDrive OAuth
// ============================================================================

/**
 * 为 Microsoft OneDrive/SharePoint 生成 OAuth2 URL
 */
export function getMicrosoftDriveOAuth2Url(state: string): string {
  if (!env.MICROSOFT_CLIENT_ID) {
    throw new Error("Microsoft 登录未启用——缺少 client ID");
  }

  const params = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    response_type: "code",
    redirect_uri: `${env.NEXT_PUBLIC_BASE_URL}/api/outlook/drive/callback`,
    scope: MICROSOFT_DRIVE_SCOPES.join(" "),
    prompt: "consent", // 确保在重新认证时返回 refresh token
    state,
  });

  return `${getMicrosoftOauthAuthorizeUrl()}?${params.toString()}`;
}

/**
 * 用 Microsoft OAuth code 换取令牌
 */
export async function exchangeMicrosoftDriveCode(code: string) {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
    throw new Error("Microsoft 登录未启用——缺少凭证");
  }

  const response = await requestMicrosoftToken({
    client_id: env.MICROSOFT_CLIENT_ID,
    client_secret: env.MICROSOFT_CLIENT_SECRET,
    code,
    redirect_uri: `${env.NEXT_PUBLIC_BASE_URL}/api/outlook/drive/callback`,
    grant_type: "authorization_code",
    scope: MICROSOFT_DRIVE_SCOPES.join(" "),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error_description || "用 code 换取令牌失败");
  }

  const tokens = await response.json();

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Microsoft 未返回 access 或 refresh token");
  }

  const { email } = await fetchMicrosoftUserProfile(tokens.access_token);

  return {
    accessToken: tokens.access_token as string,
    refreshToken: tokens.refresh_token as string,
    expiresAt: tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null,
    email,
  };
}
