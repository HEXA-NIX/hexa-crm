import crypto from "node:crypto";
import { env } from "$env/dynamic/private";
import { decryptSecret, encryptSecret } from "../plugins/secret-vault";

export const GOOGLE_DRIVE_COOKIE = "hexa_google_drive_oauth";
export const GOOGLE_DRIVE_STATE_COOKIE = "hexa_google_drive_state";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export type GoogleOAuthCredential = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  email?: string;
};

function oauthConfig() {
  const clientId = (env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID)?.trim();
  const clientSecret = (env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET)?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Google Drive no está habilitado por el administrador de Hexa");
  }
  return { clientId, clientSecret };
}

export function googleRedirectUri(requestUrl: URL): string {
  return (env.GOOGLE_DRIVE_REDIRECT_URI || process.env.GOOGLE_DRIVE_REDIRECT_URI)?.trim() || `${requestUrl.origin}/api/storage/google-drive/callback`;
}

export function createGoogleAuthorization(requestUrl: URL) {
  const { clientId } = oauthConfig();
  const state = crypto.randomBytes(24).toString("hex");
  const redirectUri = googleRedirectUri(requestUrl);
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DRIVE_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return { authorization_url: url.toString(), state };
}

export async function exchangeGoogleCode(code: string, requestUrl: URL): Promise<GoogleOAuthCredential> {
  const { clientId, clientSecret } = oauthConfig();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleRedirectUri(requestUrl),
      grant_type: "authorization_code",
    }),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || !data.access_token || !data.refresh_token) {
    throw new Error(typeof data.error_description === "string" ? data.error_description : "Google no devolvió una autorización persistente");
  }
  return {
    access_token: String(data.access_token),
    refresh_token: String(data.refresh_token),
    expires_at: Date.now() + Math.max(60, Number(data.expires_in ?? 3600) - 60) * 1000,
  };
}

export function encodeGoogleCredential(credential: GoogleOAuthCredential): string {
  return encryptSecret(JSON.stringify(credential));
}

export function decodeGoogleCredential(value: string): GoogleOAuthCredential {
  return JSON.parse(decryptSecret(value)) as GoogleOAuthCredential;
}

export async function currentGoogleAccessToken(credential: GoogleOAuthCredential): Promise<GoogleOAuthCredential> {
  if (credential.access_token && credential.expires_at > Date.now()) return credential;
  const { clientId, clientSecret } = oauthConfig();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: credential.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || !data.access_token) throw new Error("Google Drive requiere volver a autorizar la cuenta");
  return {
    ...credential,
    access_token: String(data.access_token),
    expires_at: Date.now() + Math.max(60, Number(data.expires_in ?? 3600) - 60) * 1000,
  };
}

export const googleCookieOptions = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 180,
};
